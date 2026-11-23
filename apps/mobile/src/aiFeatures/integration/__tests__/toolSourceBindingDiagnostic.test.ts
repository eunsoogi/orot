import { NativeModules } from 'react-native';
import { RetainedSourceInvalidError } from '../retainedSourceError';
import { observeToolSourceBinding } from '../toolSourceBindingDiagnostic';

let prior: unknown;
beforeEach(() => {
  prior = NativeModules.OrotProviderDiagnostics;
});
afterEach(() => {
  NativeModules.OrotProviderDiagnostics = prior;
});

test('classifies only app-owned stages and bounded outcomes without sending results or exceptions', async () => {
  const report = jest.fn<void, [string, string, string]>();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  const privateValue = { payload: 'SYNTHETIC_PRIVATE_IDENTIFIER' };
  const stale = new RetainedSourceInvalidError('SYNTHETIC_PRIVATE_REASON');
  const failed = new Error('SYNTHETIC_PRIVATE_SQL');
  await expect(
    observeToolSourceBinding('tool_event_bind_owner', async () => privateValue),
  ).resolves.toBe(privateValue);
  await expect(
    observeToolSourceBinding('tool_event_bind_owner', async () => undefined),
  ).resolves.toBeUndefined();
  await expect(
    observeToolSourceBinding('tool_event_bind_restore', async () => {
      throw stale;
    }),
  ).rejects.toBe(stale);
  await expect(
    observeToolSourceBinding('tool_event_bind_restore', async () => {
      throw failed;
    }),
  ).rejects.toBe(failed);
  expect(report.mock.calls).toEqual([
    ['storage', 'tool_event_bind_owner', 'completed'],
    ['storage', 'tool_event_bind_owner', 'unavailable'],
    ['storage', 'tool_event_bind_restore', 'stale_evidence'],
    ['storage', 'tool_event_bind_restore', 'failed'],
  ]);
});

test('disabled or unusable diagnostic sinks cannot suppress a result or replace a rejection', async () => {
  const report = jest.fn(() => {
    throw new Error('Synthetic sink error');
  });
  const work = jest.fn(async () => ({ value: 'unchanged' }));
  NativeModules.OrotProviderDiagnostics = { enabled: false, report };
  const unobserved = work();
  work.mockReturnValueOnce(unobserved);
  expect(observeToolSourceBinding('tool_event_bind_owner', work)).toBe(
    unobserved,
  );
  expect(report).not.toHaveBeenCalled();
  NativeModules.OrotProviderDiagnostics.enabled = true;
  await expect(
    observeToolSourceBinding('tool_event_bind_restore', work),
  ).resolves.toEqual({ value: 'unchanged' });
  const original = new Error('original');
  await expect(
    observeToolSourceBinding('tool_event_bind_restore', async () => {
      throw original;
    }),
  ).rejects.toBe(original);
  expect(report).toHaveBeenCalledTimes(2);
});
