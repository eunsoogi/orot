import { waitFor } from '@testing-library/react-native';
import { AppState, NativeModules, Platform } from 'react-native';
import type { fixture } from './liveResponsesProtectedFixture';

const expected = [
  'grant_lookup',
  'owner_reproof',
  'data_open',
  'stock_read',
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
    instrument(
      mode: string,
      protection: jest.Mock<Promise<boolean>, []>,
      stockRead: Awaited<ReturnType<typeof fixture>>['read'],
    ) {
      protection.mockImplementation(async () => {
        if (mode === 'valid') elapsed += 110;
        return true;
      });
      if (mode !== 'valid') return;
      const read = stockRead.getMockImplementation()!;
      stockRead.mockImplementationOnce(async (...args) => {
        elapsed += 70;
        return read(...args);
      });
    },
    holdQueue() {
      expect(
        report.mock.calls.some(([, stage]) => stage === 'admission_queue'),
      ).toBe(false);
      elapsed += 250;
    },
    async verify(mode: string) {
      const samples = () =>
        report.mock.calls.filter(([feature]) => feature === 'live_health');
      const stages = () => samples().map(([, stage]) => stage);
      if (mode === 'valid') {
        await waitFor(() => expect(stages()).toEqual(expected));
        const duration = (stage: string) =>
          Number(samples().find(([, name]) => name === stage)?.[2]);
        // The protection wait belongs to the original composite interval,
        // but not to the stock tool's awaited search interval.
        expect(duration('owner_reproof')).toBe(120);
        expect(duration('stock_read')).toBe(75);
        expect(duration('evidence_lookup')).toBe(195);
      } else if (mode === 'wrong-ack') {
        expect(stages()).not.toContain('stock_read');
        expect(stages()).not.toContain('native_handoff');
      } else if (mode === 'stop-in-queue') {
        // Stop releases the pending native result without a completed handoff.
        expect(stages()).toEqual(expected.slice(0, -1));
      } else if (mode === 'source-denied') {
        expect(stages()).not.toContain('native_handoff');
      }
      const queue = samples().filter(
        ([, stage]) => stage === 'admission_queue',
      );
      expect(queue).toHaveLength(mode === 'successor-before-promise' ? 1 : 0);
      if (mode === 'successor-before-promise') {
        expect(Number(queue[0]?.[2])).toBe(260);
        // Data open for both observations precedes promotion. The successful
        // queue span finishes after prior handoff, before the second evidence read.
        const order = stages();
        const promoted = order.indexOf('admission_queue');
        expect(promoted).toBeGreaterThan(order.indexOf('native_handoff'));
        expect(promoted).toBeLessThan(order.lastIndexOf('evidence_lookup'));
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
