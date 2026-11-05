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
}
