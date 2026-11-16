import { providerDiagnostic } from '../../providers/diagnostics';
import { observeDatabaseOwner } from '../databaseOwnerDiagnostics';
import { traceHealthContextScheduler } from '../../healthEvidence/healthContext/trace';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));
afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.mocked(providerDiagnostic).mockReset());

test('observes callback ownership without emitting private values', async () => {
  let release!: (value: string) => void;
  const pending = observeDatabaseOwner(
    'healthkit',
    () =>
      new Promise<string>(resolve => {
        release = resolve;
      }),
  );
  expect(providerDiagnostic).toHaveBeenCalledWith(
    'storage',
    'transaction_healthkit',
    'started',
  );
  release('synthetic private value');
  expect(await pending).toBe('synthetic private value');
  expect(jest.mocked(providerDiagnostic).mock.calls).toEqual([
    ['storage', 'transaction_healthkit', 'started'],
    ['storage', 'transaction_healthkit', 'completed'],
  ]);
});

test('preserves the original error for rollback even when the diagnostic bridge fails', async () => {
  const error = new Error('synthetic private error');
  jest.mocked(providerDiagnostic).mockImplementation(() => {
    throw new Error('bridge unavailable');
  });
  await expect(
    observeDatabaseOwner('memory', async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});

test('a scheduler probe neither blocks nor mislabels a still-pending callback', () => {
  let run!: () => void;
  jest.spyOn(globalThis, 'setImmediate').mockImplementation(callback => {
    run = callback;
    return 1 as unknown as ReturnType<typeof setImmediate>;
  });
  const trace = jest.fn();
  traceHealthContextScheduler(trace);
  expect(trace.mock.calls).toEqual([['scheduler', 'started']]);
  run();
  expect(trace.mock.calls).toEqual([
    ['scheduler', 'started'],
    ['scheduler', 'completed'],
  ]);
});

test('a broken scheduler trace cannot fail the read or its deferred callback', () => {
  let run!: () => void;
  jest.spyOn(globalThis, 'setImmediate').mockImplementation(callback => {
    run = callback;
    return 1 as unknown as ReturnType<typeof setImmediate>;
  });
  const trace = () => {
    throw new Error('optional trace unavailable');
  };
  expect(() => traceHealthContextScheduler(trace)).not.toThrow();
  expect(run).not.toThrow();
});

test('admission cancels a pending scheduler probe without a false completion token', () => {
  let run!: () => void;
  jest.spyOn(globalThis, 'setImmediate').mockImplementation(callback => {
    run = callback;
    return 1 as unknown as ReturnType<typeof setImmediate>;
  });
  const clear = jest
    .spyOn(globalThis, 'clearImmediate')
    .mockImplementation(() => {});
  const trace = jest.fn();
  const stop = traceHealthContextScheduler(trace);
  stop();
  run();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(trace.mock.calls).toEqual([['scheduler', 'started']]);
});
