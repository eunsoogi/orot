const prefix = 'OROT_AUTH_DIAGNOSTIC ';
const streamPreamble =
  'Filtering the log data using "process == "Orot" AND composedMessage BEGINSWITH "OROT_AUTH_DIAGNOSTIC ""';
const events = new Set([
  'authenticate-enter',
  'presentation-unavailable',
  'attempt-rejected',
  'attempt-began',
  'start-return',
  'cancel-request',
  'cancel-return',
  'system-callback-received',
  'finish-enter',
  'stale-finish-ignored',
  'session-released',
]);
const outcomes = new Set([
  'task-cancelled',
  'system-cancelled',
  'error',
  'valid-app-return',
  'invalid-app-return',
]);
const booleans = [
  'continuationRetained',
  'presentationWindowIsKey',
  'presentationWindowRetained',
  'sessionRetained',
];
const baseKeys = [
  'applicationState',
  'attempt',
  'event',
  'sceneStates',
  'sequence',
  'uptimeSeconds',
  ...booleans,
];

/** Accept only the producer's fixed schema. Never retain raw lines, unknown fields or error text. */
export function parseAuthDiagnosticLine(line) {
  // The exact filter summary retained by the native capture is tool metadata, not an app event.
  if (line === streamPreamble) return { status: 'ignored' };
  const position = line.indexOf(prefix);
  if (position < 0) return { status: 'ignored' };
  let value;
  try {
    value = JSON.parse(line.slice(position + prefix.length));
  } catch {
    return { status: 'rejected' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'rejected' };
  const keys = [
    ...baseKeys,
    ...(value.event === 'start-return' ? ['started'] : []),
    ...(value.event === 'finish-enter' ? ['outcome'] : []),
  ].sort();
  const actual = Object.keys(value).sort();
  const valid =
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index]) &&
    events.has(value.event) &&
    // Avoid coercion: an array could resemble a UUID, and an object could throw inside the stream handler.
    typeof value.attempt === 'string' &&
    (value.attempt === 'none' ||
      /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(
        value.attempt,
      )) &&
    Number.isInteger(value.sequence) &&
    value.sequence >= 1 &&
    value.sequence <= 64 &&
    Number.isFinite(value.uptimeSeconds) &&
    value.uptimeSeconds >= 0 &&
    [0, 1, 2].includes(value.applicationState) &&
    Array.isArray(value.sceneStates) &&
    value.sceneStates.length <= 8 &&
    value.sceneStates.every((state) => [-1, 0, 1, 2].includes(state)) &&
    booleans.every((key) => typeof value[key] === 'boolean') &&
    (value.event !== 'start-return' || typeof value.started === 'boolean') &&
    (value.event !== 'finish-enter' || outcomes.has(value.outcome));
  return valid ? { status: 'accepted', record: value } : { status: 'rejected' };
}
