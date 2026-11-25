import { conversationHealthSummaryBookmarkAction } from './conversationHealthSummaryBookmarkAction';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { conversationAnswerMemoryAction } from './conversationAnswerMemoryAction';
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
  const summaryBookmark =
    localModel && conversationHealthSummaryBookmarkAction(observer);
  const answerMemory =
    localModel &&
    conversationAnswerMemoryAction({
      data,
      observer,
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
    actions: [
      ...conversationHistoryAction({
        data,
        registry,
        observer,
        question,
        admittedQuestions,
      }),
      ...(answerMemory ? answerMemory.actions : []),
      ...(summaryBookmark ? summaryBookmark.actions : []),
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
    memorySaved: () =>
      summaryBookmark && summaryBookmark.committed()
        ? ('health-summary' as const)
        : Boolean(answerMemory && answerMemory.committed()),
  };
}
