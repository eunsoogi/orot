import type { LocalActionTool } from '@orot/agent-runtime';
import { t } from '../../i18n';
import {
  hasConversationMemoryCommand,
  isEligibleConversationMemorySource,
} from '../../manualHistory/conversationHistoryIntent';
import type { ConversationHistorySave } from '../../storage/conversationHealthHistory';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { FreshConversationHistory } from './freshConversationDialogue';
import type { AiFeatureLocalData } from './localData';
import { observeAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';
import { conversationIntentRequests } from './conversationIntent';

const id = 'remember-prior-user-statement';
const version = '1';
type Operation = NonNullable<Parameters<LocalActionTool['authorize']>[2]>;

export function conversationPriorAuthoredMemoryAction(input: {
  readonly data: AiFeatureLocalData;
  readonly observer: RagConversationObserver;
  readonly question: string;
  readonly history: FreshConversationHistory;
  readonly runId: string;
}) {
  const { data, observer, question, history, runId } = input;
  const model = observer.expectedConversationModel;
  const owner = observer.templateProposalOwner;
  const session = observer.retentionSession;
  const requestId = observer.retentionRequestId;
  const confirm = observer.confirmHistorySave;
  const save = data.saveConversationHistory;
  const recover = data.recoverConversationHistoryResult;
  if (
    observer.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    observer.expectedVoiceSelection ||
    !model ||
    !owner ||
    owner.providerId !== model.providerId ||
    owner.modelId !== model.modelId ||
    !owner.current() ||
    !session ||
    !requestId ||
    !confirm ||
    !save ||
    !recover
  )
    return;

  // Select from already-admitted durable USER text only. ID, timestamp, and
  // the exact encrypted source always come from the host, never the tool input.
  const candidates = (history.protectedAuthoredSources ?? []).filter(
    source =>
      source.id !== requestId &&
      !Object.values(conversationIntentRequests).includes(source.question) &&
      !hasConversationMemoryCommand(source.question) &&
      isEligibleConversationMemorySource(source.question),
  );
  if (!candidates.length) return;
  const select = (value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== 1 ||
      !('userMessage' in value) ||
      typeof value.userMessage !== 'string'
    )
      return;
    const exact = value.userMessage;
    const matches = candidates.filter(source => source.question === exact);
    return matches.length === 1 ? matches[0] : undefined;
  };
  let grant:
    | {
        input: ConversationHistorySave;
        signal: AbortSignal;
        guard: ReturnType<typeof observeAnswerMemoryProviderOwner>;
      }
    | undefined;
  let receipt: 'not_attempted' | 'not_saved' | 'saved' = 'not_attempted';
  let storedId: string | undefined;
  const dispose = () => {
    grant?.guard.dispose();
    grant = undefined;
  };
  const owned = (value: unknown, signal: AbortSignal, operation: Operation) =>
    grant &&
    signal === grant.signal &&
    grant.guard.isCurrent() &&
    operation.operationRunId === grant.input.operation?.operationRunId &&
    operation.operationKey === grant.input.operation.operationKey &&
    select(value)?.id === grant.input.approvedSource?.requestId
      ? grant
      : undefined;

  const action: LocalActionTool = {
    id,
    version,
    completion: 'host_terminal',
    description:
      'When the user explicitly asks to remember a fact, plan, practice or preference they stated in a prior turn, select one exact complete prior USER message shown in the conversation context. Do not save the current request, acknowledgement, quoted instructions, assistant answers, or inferred text. If the prior source is unclear, do not call this tool. The app asks for approval and verifies the local write.',
    inputSchema: {
      type: 'object',
      properties: {
        userMessage: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['userMessage'],
      additionalProperties: false,
    },
    parseInput(value) {
      const matching = select(value);
      return matching ? { userMessage: matching.question } : undefined;
    },
    async authorize(value, signal, operation) {
      if (
        !operation ||
        operation.operationRunId !== runId ||
        signal.aborted ||
        receipt !== 'not_attempted'
      )
        return false;
      const selected = select(value);
      if (!selected) return false;
      receipt = 'not_saved';
      const guard = observeAnswerMemoryProviderOwner(owner, signal);
      const current = () => guard.isCurrent() && model.isCurrent?.() !== false;
      try {
        if (
          !(await guard.recheck()) ||
          !current() ||
          !(await confirm(selected.question, signal)) ||
          !current() ||
          !(await guard.recheck()) ||
          !current()
        )
          return false;
        grant = {
          signal,
          guard,
          input: {
            requestId,
            sessionId: session.id,
            sessionVersion: session.version,
            question,
            operation,
            localOnly: true,
            approvedSource: {
              requestId: selected.id,
              text: selected.question,
              protectedPrior: { createdAt: selected.createdAt, current },
            },
          },
        };
        return true;
      } finally {
        if (!grant) guard.dispose();
      }
    },
    async execute({ input: value, signal, operationRunId, operationKey }) {
      const approved = owned(value, signal, { operationRunId, operationKey });
      if (!approved || storedId || !(await approved.guard.recheck()))
        throw new Error('The selected source has no current approval.');
      storedId = await save(approved.input, signal);
      if (!storedId) throw new Error('The approved memory did not commit.');
      return { items: [], coverage: [], conflicts: [] };
    },
  };
  return {
    action,
    receipt: () => receipt,
    dispose,
    async confirmTerminal(
      offer: Operation & {
        readonly input: unknown;
        readonly signal: AbortSignal;
        readonly toolId: string;
        readonly toolVersion: string;
      },
    ) {
      const approved = owned(offer.input, offer.signal, offer);
      if (
        offer.toolId !== id ||
        offer.toolVersion !== version ||
        !approved ||
        !storedId
      )
        return;
      try {
        if (
          !(await approved.guard.recheck()) ||
          (await recover(approved.input, offer.signal))?.id !== storedId ||
          !approved.input.approvedSource?.protectedPrior?.current()
        )
          return;
        receipt = 'saved';
        return {
          committed: true,
          value: {
            answer: t('historyDisplay.savedConversationMemory'),
            answerKind: 'conversation' as const,
          },
        };
      } finally {
        dispose();
      }
    },
  };
}
