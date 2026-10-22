import { parseHealthContextScope } from '../scope';
import { HEALTH_CONTEXT_TOPICS } from '../types';

const scope = {
  kind: 'health_context_period',
  version: 1,
  topic: 'measurements',
  window: {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: '2026-10-05T00:00:00Z',
    timeZone: 'UTC',
  },
};

test.each(HEALTH_CONTEXT_TOPICS)(
  'restores a fixed %s scope without retaining mutable input',
  topic => {
    const input = { ...scope, topic, window: { ...scope.window } };
    const decoded = JSON.parse(JSON.stringify(input)) as typeof input;
    const restored = parseHealthContextScope(decoded);
    expect(restored).toEqual(input);
    expect(restored).not.toBe(decoded);
    expect(restored?.window).not.toBe(decoded.window);
    decoded.window.fromInclusive = '2026-09-01T00:00:00Z';
    expect(restored?.window.fromInclusive).toBe(scope.window.fromInclusive);
  },
);

test.each([
  null,
  [],
  'health_context_period',
  { ...scope, kind: 'structured_record' },
  { ...scope, version: 2 },
  { ...scope, topic: 'unknown' },
  { ...scope, extra: 'untrusted' },
  { ...scope, window: [] },
  { ...scope, window: { ...scope.window, extra: 'untrusted' } },
  { ...scope, window: { fromInclusive: scope.window.fromInclusive } },
  { ...scope, window: { ...scope.window, timeZone: 'invalid-zone' } },
  { ...scope, window: { ...scope.window, fromInclusive: 'not-a-date' } },
  {
    ...scope,
    window: { ...scope.window, toExclusive: scope.window.fromInclusive },
  },
  {
    ...scope,
    window: { ...scope.window, toExclusive: '2026-09-01T00:00:00Z' },
  },
  {
    ...scope,
    window: { ...scope.window, toExclusive: '2027-01-01T00:00:00Z' },
  },
])('rejects malformed or widened saved scope %j', input => {
  expect(parseHealthContextScope(input)).toBeUndefined();
});
