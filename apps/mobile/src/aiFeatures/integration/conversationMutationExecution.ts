import { conversationHistoryAction } from './conversationHistoryAction';
import {
  bindConversationPhotoExecution,
  prepareConversationPhoto,
} from './conversationPhotoService';
import type { executionOptions } from './featureServiceExecution';
import type { loadConversationHistory } from './conversationHistorySources';
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
  history: Awaited<ReturnType<typeof loadConversationHistory>>;
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
  const execution = {
    ...baseExecution,
    actions: conversationHistoryAction({
      data,
      registry,
      observer,
      question,
      admittedQuestions: history.priorTurns.map(turn => turn.question),
    }),
  };
  // Photo turns cannot silently use OCR as a user-authored history statement.
  return photo
    ? bindConversationPhotoExecution(baseExecution, photo, photoEvidence!, {
        selected,
        data,
        registry,
        sessionVersion: observer!.retentionSession!.version,
      })
    : execution;
}
