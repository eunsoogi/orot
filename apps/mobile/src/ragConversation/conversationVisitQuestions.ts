import type { Appointment } from '@orot/domain';
import type { VisitQuestionEvidenceItem } from '../agent/visitQuestions/taskContract';
import type { InlineVisitReview } from '../nextVisitQuestions/inlineVisitReview';

/** In-memory review is owned by one answer; source validation remains tied to its generation. */
export interface ConversationVisitQuestions {
  readonly appointment: Appointment;
  readonly review: InlineVisitReview<VisitQuestionEvidenceItem>;
  readonly validateSource: (
    reference: VisitQuestionEvidenceItem,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** A saved turn restores its original candidates and the current saved question list. */
  readonly restoredFromSnapshot?: boolean;
  readonly restorationNotice?: string;
  readonly restorationWarning?: boolean;
  /** Frozen IDs of the restored list; newly committed candidates cannot inherit its notice. */
  readonly restorationQuestionIds?: readonly string[];
}

/** Capture legacy in-memory owners before the first edit changes item origins. */
export function restorationQuestionIds(
  visit: ConversationVisitQuestions,
): readonly string[] {
  return (
    visit.restorationQuestionIds ??
    visit.review.items.flatMap(item =>
      item.origin === 'saved' && item.question.identity
        ? [item.question.identity.id]
        : [],
    )
  );
}
