import { t } from '../../i18n';
import type { SavedQuestionReadFailureReason } from '../../nextVisitQuestions/savedQuestionRecovery';
import type { SavedVisitQuestionsLoadState } from './savedVisitQuestionTypes';

/** Returns fixed retry copy and a non-sensitive code for a failed saved-question read. */
export function savedVisitQuestionLoadFailure(
  appointmentId: string,
  failureReason: SavedQuestionReadFailureReason,
): SavedVisitQuestionsLoadState {
  const message =
    failureReason === 'missing_citation_source'
      ? t('visitQuestions.restore.missingSource')
      : failureReason === 'changed_generated_source'
        ? t('visitQuestions.restore.changedGeneratedSource')
        : failureReason === 'changed_saved_questions'
          ? t('visitQuestions.restore.changedList')
          : failureReason === 'health_context_reader_unavailable'
            ? t('visitQuestions.restore.readerUnavailable')
            : failureReason === 'changed_health_context'
              ? t('visitQuestions.restore.changedHealthContext')
              : failureReason === 'stale_artifact'
                ? t('visitQuestions.restore.staleTranscript')
                : failureReason === 'invalid_question'
                  ? t('visitQuestions.restore.invalidQuestion')
                  : t('visitQuestions.restore.retry');
  return {
    status: 'error',
    appointmentId,
    questions: [],
    message,
    failureReason,
  };
}
