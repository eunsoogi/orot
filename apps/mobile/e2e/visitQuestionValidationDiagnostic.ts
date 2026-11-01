import { createVisitQuestionTaskResponder as original } from '../src/agent/visitQuestions/taskContract';
import { currentScopeGeneration } from './visitQuestionScopeGuard';

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
let observationToken = 0;
let observations: string[] = [];

/** Only closed reason codes for the current run can reach the test-only UI. */
export function currentVisitQuestionValidationCodes(token: number) {
  return token === currentScopeGeneration() && observationToken === token
    ? observations
    : [];
}

/** The production validator runs unchanged; late results must not be attributed to a newer run. */
export function createVisitQuestionTaskResponder() {
  const token = currentScopeGeneration();
  const task = original();
  return {
    ...task,
    validateResult(...args: Parameters<typeof task.validateResult>) {
      const result = task.validateResult(...args);
      if (token === currentScopeGeneration() && result.status === 'invalid') {
        const code =
          result.reason && Object.hasOwn(reasons, result.reason)
            ? reasons[result.reason]
            : 'other';
        if (observationToken !== token) {
          observationToken = token;
          observations = [];
        }
        observations.push(code!);
      }
      return result;
    },
  };
}
