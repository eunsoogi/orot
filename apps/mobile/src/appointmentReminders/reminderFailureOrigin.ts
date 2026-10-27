/** Test-entry opt-in only: retain opaque origin on the actual rejected object, never a latest event. */
export interface ReminderFailureOrigin {
  readonly runID: string;
  readonly operationSequence: number;
}

let runID: string | undefined;
const origins = new WeakMap<object, ReminderFailureOrigin>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function enableReminderFailureOrigins(value: string): () => void {
  if (!uuid.test(value)) return () => {};
  runID = value.toLowerCase();
  return () => {
    runID = undefined;
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read only RN's actual NSError userInfo carrier; unknown/malformed origins stay unknown. */
export function captureReminderFailureOrigin(error: unknown): void {
  if (!runID || !object(error) || !object(error.userInfo)) return;
  const value = error.userInfo.orotReminderOrigin;
  if (
    !object(value) ||
    value.runID !== runID ||
    !Number.isSafeInteger(value.operationSequence) ||
    (value.operationSequence as number) <= 0
  )
    return;
  origins.set(
    error,
    Object.freeze({
      runID,
      operationSequence: value.operationSequence as number,
    }),
  );
}

export function reminderFailureOrigin(
  error: unknown,
): ReminderFailureOrigin | undefined {
  if (!runID || !object(error)) return undefined;
  const origin = origins.get(error);
  return origin?.runID === runID ? origin : undefined;
}

/** A coordinator's generic public Error retains only the selected failure's opaque test origin. */
export function preserveReminderFailureOrigin(
  source: unknown,
  target: Error,
): Error {
  const origin = reminderFailureOrigin(source);
  if (origin) origins.set(target, origin);
  return target;
}

export function observeReminderRejection<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (!runID) return operation();
  return operation().catch(error => {
    captureReminderFailureOrigin(error);
    throw error;
  });
}
