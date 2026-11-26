import { waitFor } from '@testing-library/react-native';
import { AppState, NativeModules, Platform } from 'react-native';

const expected = [
  'grant_lookup',
  'data_open',
  'evidence_lookup',
  'result_projection',
  'result_confirmation',
  'source_reproof',
  'native_handoff',
] as const;

export function liveCommonTimingFixture() {
  const phase = AppState.currentState;
  const voice = NativeModules.VoiceRealtimeModule;
  const diagnostics = NativeModules.OrotProviderDiagnostics;
  const os = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
  const report = jest.fn<void, [string, string, string]>();
  let elapsed = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => {
    elapsed += 5;
    return elapsed;
  });
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  AppState.currentState = 'active';
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  return {
    async verify(mode: string) {
      const samples = () =>
        report.mock.calls.filter(([feature]) => feature === 'live_health');
      const stages = () => samples().map(([, stage]) => stage);
      if (mode === 'valid') {
        await waitFor(() => expect(stages()).toEqual(expected));
      } else if (mode === 'stop-in-queue') {
        // Stop releases the pending native result without a completed handoff.
        expect(stages()).toEqual(expected.slice(0, -1));
      } else if (mode === 'source-denied' || mode === 'wrong-ack') {
        expect(stages()).not.toContain('native_handoff');
      }
      for (const call of samples()) {
        expect(call).toHaveLength(3);
        expect(call[2]).toMatch(/^(0|[1-9]\d*)$/u);
        expect(Number(call[2])).toBeLessThanOrEqual(300_000);
      }
    },
    restore() {
      clock.mockRestore();
      Object.defineProperty(Platform, 'OS', os);
      AppState.currentState = phase;
      NativeModules.VoiceRealtimeModule = voice;
      NativeModules.OrotProviderDiagnostics = diagnostics;
    },
  };
}
