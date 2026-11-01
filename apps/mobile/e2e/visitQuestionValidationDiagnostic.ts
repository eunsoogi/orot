import { reportVisitQuestionValidation as original } from '../src/agent/visitQuestions/validationDiagnostics';

const reasons: Readonly<Record<string, string>> = {
  'The response must be an object.': 'value_object',
  'The clarification response has extra fields.': 'clarification_fields',
  'The clarification request is invalid.': 'clarification_text',
  'The clarification contains unsafe clinical advice.': 'clarification_safety',
  'The response status is not supported.': 'status_or_fields',
  'A visit requires three to five question candidates.': 'question_count',
  'A question contains unsupported fields.': 'question_fields',
  'A question text is invalid.': 'question_text',
  'A rationale or priority is invalid.': 'rationale_or_priority',
  'A question must cite one to three unique evidence IDs.': 'evidence_shape',
  'A question cited evidence outside the current result set.':
    'evidence_unknown',
  'A visit question contains unsafe clinical advice.': 'question_safety',
  'A visit question contains an unsupported date or numeric value.':
    'unsupported_fact',
  'A visit question must end with a question mark.': 'question_form',
};

/** Preserve the production observer and expose only a fixed reason code in the opt-in bundle. */
export function reportVisitQuestionValidation(
  ...args: Parameters<typeof original>
) {
  original(...args);
  const result = args[0];
  if (result.status === 'invalid') {
    const code =
      result.reason && Object.hasOwn(reasons, result.reason)
        ? reasons[result.reason]
        : 'other';
    console.info(`OROT_SYNTHETIC_VALIDATION ${code}`);
  }
}
