import {
  conversationExecutionDiagnostics,
  createExecutionDiagnostics,
} from '../conversationExecutionDiagnostics';

test('bounds process-local lifecycle history and returns independent snapshots', () => {
  const record = createExecutionDiagnostics(true, () => 'background');
  for (let i = 0; i < 100; i++) record('foreground');
  record('interrupt', 'expired');
  const snapshot = conversationExecutionDiagnostics();
  expect(snapshot).toHaveLength(64);
  expect(snapshot.at(-1)).toEqual({
    sequence: expect.any(Number),
    elapsedMs: expect.any(Number),
    event: 'interrupt',
    phase: 'background',
    bridgeAvailable: true,
    reason: 'expired',
  });
  snapshot.pop();
  expect(conversationExecutionDiagnostics()).toHaveLength(64);
});

test('separates request ownership without including request identifiers or payloads', () => {
  const one = createExecutionDiagnostics(false, () => 'active');
  const two = createExecutionDiagnostics(undefined, () => 'unknown');
  one('denied');
  two('release');
  const [first, second] = conversationExecutionDiagnostics().slice(-2);
  expect(first.sequence).not.toBe(second.sequence);
  expect(first.bridgeAvailable).toBe(false);
  expect(second.bridgeAvailable).toBeNull();
  expect(Object.keys(first).sort()).toEqual([
    'bridgeAvailable',
    'elapsedMs',
    'event',
    'phase',
    'sequence',
  ]);
});
