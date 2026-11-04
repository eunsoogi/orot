import type { TaskClarificationValue, TaskResultValidation } from './contracts';

/** Projects copy only from an explicit clarification result returned by task validation. */
export function clarificationMessageFromValidation(
  validation: TaskResultValidation<unknown>,
): string | undefined {
  if (validation.status === 'needs_clarification') return validation.message;
  if (validation.status !== 'valid' || !isTaskClarificationValue(validation.value))
    return undefined;
  return validation.value.message;
}

/** Some task result unions carry their validated clarification as a normal valid value. */
function isTaskClarificationValue(value: unknown): value is TaskClarificationValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === 'needs_clarification' &&
    typeof candidate.message === 'string' &&
    candidate.message.trim().length > 0
  );
}
