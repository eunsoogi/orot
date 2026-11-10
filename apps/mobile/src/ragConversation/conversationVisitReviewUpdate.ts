import type { VisitQuestionEvidenceItem } from '../agent/visitQuestions/taskContract';
import type { InlineVisitReview } from '../nextVisitQuestions/inlineVisitReview';
import type { ConversationVisitQuestions } from './conversationVisitQuestions';
import type {
  ConversationSession,
  ConversationSnapshot,
} from './conversationSessionTypes';

/** Reject late edits when their original session or message no longer owns the review. */
export function createConversationVisitReviewUpdater(
  snapshot: () => ConversationSnapshot,
  update: (id: number, change: Partial<ConversationSession>) => void,
  disposed: () => boolean,
) {
  return (
    id: number,
    messageId: number,
    review: InlineVisitReview<VisitQuestionEvidenceItem>,
    validateSource?: ConversationVisitQuestions['validateSource'],
  ) => {
    const session = snapshot().sessions.find(item => item.id === id);
    const message = session?.messages.find(item => item.id === messageId);
    if (
      disposed() ||
      !message?.visitQuestions ||
      message.visitQuestions.review.ownerKey !== review.ownerKey
    )
      return false;
    update(id, {
      messages: session!.messages.map(item =>
        item.id === messageId
          ? {
              ...item,
              visitQuestions: {
                ...message.visitQuestions!,
                review,
                ...(validateSource ? { validateSource } : {}),
              },
            }
          : item,
      ),
    });
    return true;
  };
}
