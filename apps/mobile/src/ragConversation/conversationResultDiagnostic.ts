import { isObject } from './taskHistory';
import type { JsonValue } from '@orot/model-runtime';
import type { TaskResultValidation } from '@orot/agent-runtime';
import { providerDiagnostic } from '../providers/diagnostics';

export type ConversationResultDiagnostic =
  | 'task_value_object'
  | 'task_value_fields'
  | 'task_value_completion'
  | 'task_value_kind'
  | 'task_answer_type'
  | 'task_answer_empty'
  | 'task_answer_length'
  | 'task_clinical_rejected'
  | 'task_validator_exception'
  | 'task_validator_other';

/** This classifier observes only already rejected values, never makes admission decisions.
 * No keys, values, lengths, source IDs, exception text or model text leave this function. */
function classify(
  value: JsonValue,
  reason: string,
): ConversationResultDiagnostic {
  if (reason === 'The answer contained a definitive clinical claim.')
    return 'task_clinical_rejected';
  if (reason !== 'The answer was empty or outside the supported size.')
    return 'task_validator_other';
  if (!isObject(value)) return 'task_value_object';
  if (
    Object.keys(value).some(
      key =>
        ![
          'answer',
          'answerKind',
          'completion',
          'literature',
          'localClaims',
        ].includes(key),
    )
  )
    return 'task_value_fields';
  if (
    'completion' in value &&
    value.completion !== 'complete' &&
    value.completion !== 'partial'
  )
    return 'task_value_completion';
  if (
    'answerKind' in value &&
    !['grounded', 'conversation', 'prior_output'].includes(
      value.answerKind as string,
    )
  )
    return 'task_value_kind';
  if (typeof value.answer !== 'string') return 'task_answer_type';
  if (
    !value.answer.trim() &&
    !('literature' in value) &&
    !('localClaims' in value)
  )
    return 'task_answer_empty';
  if (value.answer.length > 4000) return 'task_answer_length';
  return 'task_validator_other';
}

function report(code: ConversationResultDiagnostic) {
  try {
    providerDiagnostic('rag', 'validation', code);
  } catch {
    // Optional observation must neither replace the original failure nor retry inference.
  }
}

/** Coverage checks may consult the same validator before the terminal decision.
 * A token means validator rejection, not proof of the final workflow outcome. */
export function observeConversationResultValidation<T>(
  value: JsonValue,
  validate: () => TaskResultValidation<T>,
): TaskResultValidation<T> {
  let result: TaskResultValidation<T>;
  try {
    result = validate();
  } catch (error) {
    report('task_validator_exception');
    throw error;
  }
  if (result.status === 'invalid') {
    try {
      report(classify(value, result.reason));
    } catch {
      // A diagnostic classifier failure also preserves the original decision.
    }
  }
  return result;
}
