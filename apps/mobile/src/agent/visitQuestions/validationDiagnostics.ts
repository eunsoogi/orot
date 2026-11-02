import { providerDiagnostic } from '../../providers/diagnostics';
import { reportVisitQuestionCoverage } from './coverageDiagnostics';
import { UNSUPPORTED_QUESTION_FACTS_REASON } from './taskValidation';
import type { VisitQuestionEvidenceBatch } from './taskContract';

const knownReasons = {
  'A visit requires three to five question candidates.': 'task_question_count',
  'A question text is invalid.': 'task_question_text',
  'A rationale or priority is invalid.': 'task_question_rationale',
  'A question must cite one to three unique evidence IDs.':
    'task_question_evidence',
  'A question cited evidence outside the current result set.':
    'task_question_evidence',
  'A question contains unsupported fields.': 'task_question_shape',
  'The response status is not supported.': 'task_question_shape',
  'A visit question must end with a question mark.': 'task_question_form',
  'The clarification contains unsafe clinical advice.': 'task_question_safety',
  'A visit question contains unsafe clinical advice.': 'task_question_safety',
} as const;

/** Only local fixed reasons become codes; rejected output and unknown text never leave this function. */
export function reportVisitQuestionValidation(
  result: {
    status: string;
    reason?: string;
  },
  evidence?: VisitQuestionEvidenceBatch,
) {
  if (evidence) reportVisitQuestionCoverage(evidence);
  if (
    result.status !== 'invalid' ||
    result.reason === UNSUPPORTED_QUESTION_FACTS_REASON
  ) {
    // The fact validator already emitted a specific closed code for this reason.
    // Avoid following it with a duplicate generic schema code.
    return;
  }
  const code =
    result.reason && Object.hasOwn(knownReasons, result.reason)
      ? knownReasons[result.reason as keyof typeof knownReasons]
      : 'task_schema';
  providerDiagnostic('visit', 'validation', code);
}
