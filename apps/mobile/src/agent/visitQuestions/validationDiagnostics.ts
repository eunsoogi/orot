import { providerDiagnostic } from '../../providers/diagnostics';

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
} as const;

/** Only local fixed reasons become codes; rejected output and unknown text never leave this function. */
export function reportVisitQuestionValidation(result: {
  status: string;
  reason?: string;
}) {
  if (result.status !== 'invalid') return;
  const code =
    result.reason && Object.hasOwn(knownReasons, result.reason)
      ? knownReasons[result.reason as keyof typeof knownReasons]
      : 'task_schema';
  providerDiagnostic('visit', 'validation', code);
}
