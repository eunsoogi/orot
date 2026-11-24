import { NativeModules } from 'react-native';
import { measureLiveHealth, measureLiveHealthSync } from '../liveHealthLatency';

test('disabled measurement keeps the original work and emits nothing', async () => {
  const original = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { enabled: false, report };
  try {
    const result = Promise.resolve('synthetic-result');
    expect(measureLiveHealth('data_open', () => result)).toBe(result);
    expect(measureLiveHealthSync('result_projection', () => 13)).toBe(13);
    await result;
    expect(report).not.toHaveBeenCalled();
  } finally {
    NativeModules.OrotProviderDiagnostics = original;
  }
});

test('an opt-in diagnostic sink failure never replaces work or leaks its error', async () => {
  const original = NativeModules.OrotProviderDiagnostics;
  const report = jest.fn(() => {
    throw new Error('diagnostic failure');
  });
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  try {
    expect(
      await measureLiveHealth('native_handoff', async () => 'synthetic-result'),
    ).toBe('synthetic-result');
    const ownedError = new Error('owned failure');
    await expect(
      measureLiveHealth('evidence_lookup', async () => {
        throw ownedError;
      }),
    ).rejects.toBe(ownedError);
    expect(report).toHaveBeenCalled();
    expect(JSON.stringify(report.mock.calls)).not.toContain('owned failure');
  } finally {
    NativeModules.OrotProviderDiagnostics = original;
  }
});
