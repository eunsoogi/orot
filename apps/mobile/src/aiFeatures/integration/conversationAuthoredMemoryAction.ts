import {
  isExactStandingAuthoredMemorySentence,
  type StandingAuthoredMemoryApproval,
} from '../../storage/standingAuthoredMemoryApproval';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { observeAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';
import type {
  LocalActionTool,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from '../../ragConversation/task';
import type { ConversationHistorySave } from '../../storage/conversationHealthHistory';
import type { ConversationActionIdentity } from '../../storage/conversationActionReceipt';
import { t } from '../../i18n';

type ConfirmTerminal = NonNullable<
  MultiAgentWorkflowOptions<GroundedRagAnswer>['confirmTerminalLocalAction']
>;
const actionId = 'remember-current-user-statement';
import type { RagConversationObserver } from '../../ragConversation/service';
import { exactAuthoredMemorySentence } from '../../storage/authoredMemorySelection';
import type { AiFeatureLocalData } from './localData';

export function conversationAuthoredMemoryAction(input: {
  data: AiFeatureLocalData;
  observer?: RagConversationObserver;
  question: string;
  standing?: RagConversationObserver['authorizeStandingAuthoredMemory'];
  terminal?: {
    owner: NonNullable<RagConversationObserver['templateProposalOwner']>;
    runId: string;
  };
}) {
  const { data, observer, question, terminal, standing } = input;
  // The standing terminal never resumes under the old per-item consent descriptor.
  const actionVersion = standing ? '2' : '1';
  const owner = observer?.retentionSession;
  const requestId = observer?.retentionRequestId;
  const confirm = observer?.confirmHistorySave;
  const model = observer?.expectedConversationModel;
  const nativeProof = observer?.templateProposalOwner;
  const onDeviceOwner =
    observer?.protectedLocalInput === true &&
    model?.providerId === APPLE_PROVIDER_ID &&
    nativeProof?.providerId === model.providerId &&
    nativeProof.modelId === model.modelId
      ? nativeProof
      : undefined;
  let approved:
    | {
        statement: string;
        operation?: ConversationActionIdentity;
        signal: AbortSignal;
        guard?: ReturnType<typeof observeAnswerMemoryProviderOwner>;
        standingApproval?: StandingAuthoredMemoryApproval;
      }
    | undefined;
  let pending:
    | { input: ConversationHistorySave; grant: NonNullable<typeof approved> }
    | undefined;
  const dispose = () => {
    pending?.grant.guard?.dispose();
    pending = undefined;
    approved?.guard?.dispose();
    approved = undefined;
  };
  let receipt: 'not_attempted' | 'not_saved' | 'saved' = 'not_attempted';
  const result = {
    actions: [] as LocalActionTool[],
    receipt: () => receipt,
    dispose,
    confirmTerminal: undefined as ConfirmTerminal | undefined,
  };
  if (
    observer?.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript ||
    !requestId ||
    !owner ||
    (!standing && !confirm) ||
    (standing && !terminal) ||
    (terminal
      ? !terminal.owner.current() || !data.confirmAuthoredMemoryTerminal
      : !model?.isCurrent && !onDeviceOwner?.current()) ||
    !data.saveConversationHistory
  )
    return result;
  const exact = standing
    ? isExactStandingAuthoredMemorySentence
    : exactAuthoredMemorySentence;
  const parse = (value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== 1 ||
      !('statement' in value) ||
      !exact(question, value.statement)
    )
      return undefined;
    return { statement: value.statement };
  };
  const current = (
    signal: AbortSignal,
    guard?: NonNullable<typeof approved>['guard'],
  ) =>
    !signal.aborted &&
    (guard ? guard.isCurrent() : model?.isCurrent?.() === true);
  if (terminal) {
    result.confirmTerminal = async offer => {
      const prepared = pending;
      if (
        !prepared ||
        prepared.grant.signal !== offer.signal ||
        prepared.grant.operation?.operationRunId !== offer.operationRunId ||
        prepared.grant.operation?.operationKey !== offer.operationKey ||
        offer.toolId !== actionId ||
        offer.toolVersion !== actionVersion ||
        parse(offer.input)?.statement !== prepared.grant.statement
      )
        return;
      pending = undefined;
      const guard = prepared.grant.guard;
      try {
        if (
          !guard ||
          !(await guard.recheck()) ||
          !(await data.confirmAuthoredMemoryTerminal?.(
            prepared.input,
            offer.signal,
          )) ||
          !guard.isCurrent()
        )
          return;
        receipt = 'saved';
        return {
          committed: true,
          value: {
            answer: t('historyDisplay.savedConversationMemory'),
            answerKind: 'conversation',
          },
        };
      } finally {
        guard?.dispose();
      }
    };
  }
  result.actions.push({
    id: actionId,
    version: actionVersion,
    ...(terminal ? { completion: 'host_terminal' as const } : {}),
    description: standing
      ? 'Use only to retain one useful standing reply preference or recurring non-sensitive practice directly stated in the current user message. No remember command is required. Copy its exact complete sentence, never prior turns, questions, speculation, quotes, secrets or other categories. Local Settings permission is checked separately. Never claim a save without the host receipt.'
      : 'Use only when the current user explicitly asks to remember a fact, plan, practice, project, goal or preference they directly state in this same message. Copy exactly one complete factual sentence from the current user message; never copy the request to save, filler, prior replies, quoted text, questions, guesses or credentials. The app displays the exact sentence for local approval. Never claim it was saved without a successful tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        statement: { type: 'string', minLength: 8, maxLength: 900 },
      },
      required: ['statement'],
      additionalProperties: false,
    },
    parseInput: parse,
    async authorize(value, signal, operation) {
      if (
        receipt !== 'not_attempted' ||
        signal.aborted ||
        (terminal && operation?.operationRunId !== terminal.runId)
      )
        return false;
      dispose();
      receipt = 'not_saved';
      const parsed = parse(value);
      if (!parsed) return false;
      const authority = terminal?.owner ?? onDeviceOwner;
      const guard = authority
        ? observeAnswerMemoryProviderOwner(authority, signal)
        : undefined;
      let keep = false;
      try {
        if (!current(signal, guard) || (guard && !(await guard.recheck())))
          return false;
        const standingApproval = standing
          ? await standing(parsed.statement, signal)
          : undefined;
        if (
          (standing
            ? !standingApproval?.current()
            : !(await confirm?.(parsed.statement, signal))) ||
          !current(signal, guard) ||
          (guard && !(await guard.recheck()))
        )
          return false;
        approved = {
          ...parsed,
          signal,
          guard,
          operation: terminal ? operation : undefined,
          ...(standingApproval ? { standingApproval } : {}),
        };
        keep = true;
        return true;
      } finally {
        if (!keep) guard?.dispose();
      }
    },
    async execute({ input: value, signal, operationRunId, operationKey }) {
      const grant = approved;
      approved = undefined;
      try {
        if (
          !grant ||
          grant.signal !== signal ||
          !current(signal, grant.guard) ||
          (terminal &&
            (grant.operation?.operationRunId !== operationRunId ||
              grant.operation?.operationKey !== operationKey)) ||
          (grant.guard && !(await grant.guard.recheck())) ||
          parse(value)?.statement !== grant.statement
        )
          throw new Error('A fresh authored memory approval is required.');
        const save: ConversationHistorySave = {
          requestId,
          sessionId: owner.id,
          sessionVersion: owner.version,
          question,
          localOnly: true,
          approvedCurrentSentence: {
            statement: grant.statement,
            current: () => current(signal, grant.guard),
          },
          ...(grant.operation && { authoredTerminal: grant.operation }),
          ...(grant.standingApproval
            ? { standingApproval: grant.standingApproval }
            : {}),
        };
        const id = await data.saveConversationHistory?.(save, signal);
        if (!id) throw new Error('The approved memory could not be saved.');
        if (terminal) pending = { input: save, grant };
        else receipt = 'saved';
        return { items: [], coverage: [], conflicts: [] };
      } finally {
        if (!pending) grant?.guard?.dispose();
      }
    },
  });
  return result;
}
