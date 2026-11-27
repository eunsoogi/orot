import { conversationPriorAuthoredMemoryAction } from './conversationPriorAuthoredMemoryAction';
import { settleConversationMemoryReceipt } from './conversationMemoryReceipts';
import { conversationAuthoredMemoryAction } from './conversationAuthoredMemoryAction';
import { conversationHealthSummaryBookmarkAction } from './conversationHealthSummaryBookmarkAction';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { conversationAnswerMemoryAction } from './conversationAnswerMemoryAction';
import { conversationAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';
import { conversationHistoryAction } from './conversationHistoryAction';
import {
  bindConversationPhotoExecution,
  prepareConversationPhoto,
} from './conversationPhotoService';
import type { executionOptions } from './featureServiceExecution';
import type { ConversationEntryContext } from './conversationIntent';
import type { FreshConversationHistory } from './freshConversationDialogue';
import type { RagConversationObserver } from '../../ragConversation/service';

/** Preserve the existing photo transfer contract while adding local-only actions. */
export function conversationMutationExecution(input: {
  baseExecution: ReturnType<typeof executionOptions>;
  photo: RagConversationObserver['photoInput'];
  photoEvidence: Awaited<ReturnType<typeof prepareConversationPhoto>>;
  selected: Parameters<typeof bindConversationPhotoExecution>[3]['selected'];
  data: Parameters<typeof bindConversationPhotoExecution>[3]['data'];
  registry: Parameters<typeof bindConversationPhotoExecution>[3]['registry'];
  observer?: RagConversationObserver;
  question: string;
  history: FreshConversationHistory;
  remoteAnswerMemory?: boolean;
  remoteMemory?: boolean | ConversationEntryContext;
}) {
  const {
    baseExecution,
    photo,
    photoEvidence,
    selected,
    data,
    registry,
    observer,
    question,
    history,
  } = input;
  const admittedQuestions = history.priorTurns.map(turn => turn.question);
  const localModel =
    selected.provider.id === APPLE_PROVIDER_ID && !selected.remoteProcessing;
  const runId = baseExecution.execution.operationRunId;
  const reportBookmark =
    localModel && conversationHealthSummaryBookmarkAction(observer, runId);
  const entry =
    typeof input.remoteMemory === 'object' ? input.remoteMemory : undefined;
  // A consumed shortcut can leave plain Conversation entry metadata behind.
  // It grants neither a report target nor permission to change the recipient.
  const unboundEntry =
    entry &&
    !entry.appointmentId &&
    !entry.dailyReport &&
    !entry.directDailyReportRequest &&
    !entry.typedPossibilityReport;
  const untargetedComposerEntry =
    unboundEntry && entry.intent === 'conversation';
  // A Possibilities shortcut retains its discussion context, not authority
  // over a fresh composer turn's exact prior authored statement.
  const authoredPossibilityFollowup =
    unboundEntry &&
    entry.intent === 'possibilities' &&
    !entry.reportRequest &&
    observer?.inputOrigin === 'composer';
  const plainAuthoredEntry = untargetedComposerEntry && !entry.reportRequest;
  const ordinaryModelOwner = observer?.templateProposalOwner;
  const ordinaryMemorySidecar =
    !photo &&
    !observer?.selectedRecordingTranscript &&
    !observer?.protectedLocalInput &&
    !observer?.expectedVoiceSelection &&
    runId &&
    observer?.inputOrigin === 'composer' &&
    (!entry || plainAuthoredEntry) &&
    selected.provider.capabilities.toolCalling &&
    ordinaryModelOwner?.providerId === selected.provider.id &&
    ordinaryModelOwner.modelId === selected.modelId &&
    ordinaryModelOwner.current()
      ? observer.bindOrdinaryMemorySidecar?.(runId, ordinaryModelOwner)
      : undefined;
  const allowRemoteAnswer =
    input.remoteAnswerMemory ||
    input.remoteMemory === true ||
    plainAuthoredEntry;
  const remoteOwner = allowRemoteAnswer
    ? conversationAnswerMemoryProviderOwner(selected, observer)
    : undefined;
  const terminal =
    remoteOwner && runId ? { owner: remoteOwner, runId } : undefined;
  const authoredMemory =
    (localModel || terminal) &&
    conversationAuthoredMemoryAction({ data, observer, question, terminal });
  const answerMemory =
    (localModel || (allowRemoteAnswer && remoteOwner)) &&
    conversationAnswerMemoryAction({
      data,
      observer,
      terminalRunId: baseExecution.execution.operationRunId,
      remoteOwner,
      onDeviceArchiveEligible: localModel,
      admittedAnswerIds: new Set([
        ...(history.historicalDialogueParents ?? []).map(turn => turn.id),
        ...history.references.flatMap(reference => {
          const original = registry.resolve(reference);
          return original?.sourceKind === 'generated_artifact'
            ? [original.sourceId]
            : [];
        }),
      ]),
    });
  const priorAuthored =
    // Consuming a Daily Report entry changes its intent but retains the
    // old request metadata. It is not the selected report identity and must
    // not hide the already local-only prior-statement action.
    localModel &&
    observer &&
    runId &&
    (!entry || untargetedComposerEntry || authoredPossibilityFollowup)
      ? conversationPriorAuthoredMemoryAction({
          data,
          observer,
          question,
          history,
          runId,
        })
      : undefined;
  const confirmAuthored = authoredMemory && authoredMemory.confirmTerminal;
  const confirmAnswer = answerMemory ? answerMemory.confirmTerminal : undefined;
  const confirmReport = reportBookmark
    ? reportBookmark.confirmTerminal
    : undefined;
  type TerminalOffer = Parameters<
    NonNullable<
      ReturnType<typeof conversationAuthoredMemoryAction>['confirmTerminal']
    >
  >[0];
  const execution = {
    ...baseExecution,
    ...(confirmAuthored || confirmAnswer || priorAuthored || confirmReport
      ? {
          confirmTerminalLocalAction: async (offer: TerminalOffer) =>
            offer.toolId === 'remember-current-user-statement'
              ? confirmAuthored?.(offer)
              : offer.toolId === priorAuthored?.action.id
                ? priorAuthored.confirmTerminal(offer)
                : offer.toolId === 'remember-daily-report' ||
                    offer.toolId === 'remember-health-summary' ||
                    offer.toolId === 'remember-possibilities-report'
                  ? confirmReport?.(offer)
                  : confirmAnswer?.(offer),
        }
      : {}),
    actions: [
      ...(ordinaryMemorySidecar ? [ordinaryMemorySidecar] : []),
      ...(!observer?.protectedLocalInput && !priorAuthored
        ? conversationHistoryAction({
            data,
            registry,
            observer,
            question,
            admittedQuestions,
          })
        : []),
      ...(priorAuthored ? [priorAuthored.action] : []),
      ...(authoredMemory ? authoredMemory.actions : []),
      ...(answerMemory ? answerMemory.actions : []),
      ...(reportBookmark ? reportBookmark.actions : []),
    ],
  };
  // Photo turns cannot silently use OCR as a user-authored history statement.
  return {
    execution: photo
      ? bindConversationPhotoExecution(baseExecution, photo, photoEvidence!, {
          selected,
          data,
          registry,
          sessionVersion: observer!.retentionSession!.version,
        })
      : execution,
    disposeAnswerMemory() {
      if (answerMemory) answerMemory.dispose?.();
      if (authoredMemory) authoredMemory.dispose();
      if (priorAuthored) priorAuthored.dispose();
    },
    memorySaved() {
      const receipt = settleConversationMemoryReceipt({
        authored:
          priorAuthored && priorAuthored.receipt() !== 'not_attempted'
            ? priorAuthored.receipt()
            : authoredMemory
              ? authoredMemory.receipt()
              : undefined,
        priorAnswer: answerMemory ? answerMemory.receipt() : undefined,
        reportCommitted: Boolean(reportBookmark && reportBookmark.committed()),
      });
      // The old no-transfer boundary remains. A model answer on that
      // explicitly reserved route is not proof of a local mutation.
      return observer?.protectedLocalInput && receipt === 'not_attempted'
        ? 'authored-not-saved'
        : receipt;
    },
  };
}
