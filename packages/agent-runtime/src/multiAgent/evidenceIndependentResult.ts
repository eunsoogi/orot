import type { JsonValue } from '@orot/model-runtime';
import type { TaskResponderContract, TaskResponderInput } from './contracts';

/** Task-owned semantics, not greeting keywords or permission to accept arbitrary uncited facts. */
export function isEvidenceIndependentResult<TResult>(
  task: TaskResponderContract<TResult>,
  value: JsonValue,
  input: TaskResponderInput,
): boolean {
  if (task.requireAllEvidenceCitations) return false;
  try {
    return task.isEvidenceIndependentResult?.(value, input) === true;
  } catch {
    // A broken task policy must retain the normal evidence requirement.
    return false;
  }
}
