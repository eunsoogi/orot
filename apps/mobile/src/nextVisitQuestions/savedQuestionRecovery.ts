/** Closed reason codes keep storage and evidence failures free of record text. */
export type SavedQuestionReadFailureReason =
  | 'storage_read_failed'
  | 'invalid_question'
  | 'missing_citation_source'
  | 'stale_artifact'
  | 'changed_saved_questions'
  | 'changed_health_context'
  | 'health_context_reader_unavailable'
  | 'changed_generated_source'
  | 'unknown_read_failure';

/** Actions let a conversation surface retry, refresh, or evidence review explicitly. */
export type VisitQuestionPreflightRecovery =
  | { readonly status: 'loading'; readonly action: 'retry_saved_question_read' }
  | {
      readonly status: 'read_failed';
      readonly reason: SavedQuestionReadFailureReason;
      readonly action: 'retry_saved_question_read';
    }
  | {
      readonly status: 'appointment_mismatch';
      readonly action: 'refresh_appointment';
    }
  | {
      readonly status: 'questions_changed';
      readonly reason: 'changed_saved_questions';
      readonly action: 'retry_saved_question_read';
    }
  | {
      readonly status: 'stale_evidence';
      readonly reason:
        | 'stale_artifact'
        | 'changed_health_context'
        | 'changed_generated_source';
      readonly action: 'revalidate_saved_question_sources';
    }
  | {
      readonly status: 'invalid_saved_questions';
      readonly reason: 'invalid_question' | 'missing_citation_source';
      readonly action: 'review_saved_questions';
    };

/** Maps a closed loader reason to the recovery action the conversation can offer. */
export function recoveryForSavedQuestionReadFailure(
  reason: SavedQuestionReadFailureReason,
): VisitQuestionPreflightRecovery {
  switch (reason) {
    case 'changed_saved_questions':
      return {
        status: 'questions_changed',
        reason,
        action: 'retry_saved_question_read',
      };
    case 'stale_artifact':
    case 'changed_health_context':
    case 'changed_generated_source':
      return {
        status: 'stale_evidence',
        reason,
        action: 'revalidate_saved_question_sources',
      };
    case 'invalid_question':
    case 'missing_citation_source':
      return {
        status: 'invalid_saved_questions',
        reason,
        action: 'review_saved_questions',
      };
    default:
      return {
        status: 'read_failed',
        reason,
        action: 'retry_saved_question_read',
      };
  }
}
