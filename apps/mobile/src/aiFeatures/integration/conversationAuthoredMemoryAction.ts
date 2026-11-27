import {
  authoredMemoryToolDescription,
  authoredMemoryToolParser,
} from './conversationAuthoredMemoryToolDescription';
import type { StandingAuthoredMemoryApproval } from '../../storage/standingAuthoredMemoryApproval';
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
import type { AiFeatureLocalData } from './localData';

export function conversationAuthoredMemoryAction(input: {
  data: AiFeatureLocalData;
  observer?: RagConversationObserver;
  question: string;
  standing?: RagConversationObserver['authorizeStandingAuthoredMemory'];
  generalStanding?: boolean;
  terminal?: {
    owner: NonNullable<RagConversationObserver['templateProposalOwner']>;
    runId: string;
  };
}) {
  const { data, observer, question, terminal, standing } = input;
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
  const parse = authoredMemoryToolParser(
    question,
    !!standing,
    input.generalStanding === true,
  );
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
    description: authoredMemoryToolDescription(
      Boolean(standing),
      input.generalStanding === true,
    ),
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
