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
  const authoredMemory =
    localModel &&
    conversationAuthoredMemoryAction({ data, observer, question });
  const reportBookmark =
    localModel && conversationHealthSummaryBookmarkAction(observer);
  const remoteOwner = input.remoteAnswerMemory
    ? conversationAnswerMemoryProviderOwner(selected, observer)
    : undefined;
  const answerMemory =
    (localModel || remoteOwner) &&
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
  const execution = {
    ...baseExecution,
    ...(answerMemory && answerMemory.confirmTerminal
      ? { confirmTerminalLocalAction: answerMemory.confirmTerminal }
      : {}),
    actions: [
      ...conversationHistoryAction({
        data,
        registry,
        observer,
        question,
        admittedQuestions,
      }),
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
    },
    memorySaved: () =>
      settleConversationMemoryReceipt({
        authored: authoredMemory ? authoredMemory.receipt() : undefined,
        priorAnswer: answerMemory ? answerMemory.receipt() : undefined,
        reportCommitted: Boolean(reportBookmark && reportBookmark.committed()),
      }),
  };
}
