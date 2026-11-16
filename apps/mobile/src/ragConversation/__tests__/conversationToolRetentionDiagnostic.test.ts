import { NativeModules } from 'react-native';
import { observeToolRetention } from '../conversationToolRetentionDiagnostic';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';

// Only closed stage/result codes reach native; the original result or failure stays authoritative.
afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});
test.each([
  'tool_event_capture',
  'tool_event_write',
  'tool_event_bind',
] as const)('observes %s without payload or identifiers', async stage => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const result = { privateFixture: 'synthetic private value' };
  await expect(observeToolRetention(stage, async () => result)).resolves.toBe(
    result,
  );
  expect(report.mock.calls).toEqual([
    ['storage', stage, 'started'],
    ['storage', stage, 'completed'],
  ]);
});
test.each([
  new RetainedSourceInvalidError('synthetic private cause'),
  new Error('synthetic private cause'),
])(
  'keeps the original failure while reporting only a closed category',
  async failure => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    await expect(
      observeToolRetention('tool_event_capture', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(report.mock.calls[1]).toEqual([
      'storage',
      'tool_event_capture',
      failure instanceof RetainedSourceInvalidError
        ? 'stale_evidence'
        : 'failed',
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain('private');
  },
);
test('diagnostic sink throws cannot change either storage outcome', async () => {
  NativeModules.OrotProviderDiagnostics = {
    report: () => {
      throw new Error('sink');
    },
  };
  await expect(
    observeToolRetention('tool_event_write', async () => 42),
  ).resolves.toBe(42);
  const failure = new Error('storage');
  await expect(
    observeToolRetention('tool_event_write', async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});
