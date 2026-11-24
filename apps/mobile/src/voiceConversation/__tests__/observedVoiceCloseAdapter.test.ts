import { parseObservedVoiceCaptions } from '../observedVoiceCaptions';
import { NativeModules, Platform } from 'react-native';
import {
  beginConsentReset,
  finishConsentReset,
} from '../../agent/execution/consentRevision';
import { nativeLiveVoice } from '../nativeRealtimeVoice';
import { createVoiceEndReceipt } from '../voiceEndReceipt';

test.each([
  [true, true, false, true],
  [true, false, false, false],
  [false, true, false, false],
  [true, true, true, false],
])(
  'graceful=%s matching=%s revoked=%s admits exact native observed close=%s',
  async (graceful, matching, revoked, saved) => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const callId = 'live-99-1';
    const duration = { callId, durationSeconds: 52 };
    const captions = {
      callId: matching ? callId : 'live-99-2',
      status: 'observed_incomplete',
      lines: [{ order: 1, role: 'user', text: 'Synthetic corpus fragment' }],
    };
    const prior = NativeModules.VoiceRealtimeModule;
    NativeModules.VoiceRealtimeModule = {
      openLiveCall: jest.fn(async () => {}),
      closeLiveCall: jest.fn(async () => ({
        kind: 'live_observed_close',
        duration,
        captions,
      })),
      stopRealtimeCall: jest.fn(async () => duration),
      interruptRealtimeOutput: jest.fn(),
      pauseRealtimeCall: jest.fn(),
      resumeRealtimeCall: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    const retain = jest.fn(async () => {});
    try {
      const adapter = nativeLiveVoice(
        id =>
          createVoiceEndReceipt({
            callId: id,
            isCurrent: () => true,
            retain,
          }).accept,
      )!;
      await adapter.open(
        callId,
        'gpt-live-1.1',
        'synthetic-key',
        '',
        false,
        { schema: 1, language: 'ko', voice: 'noeul' },
        () => true,
      );
      const closing = adapter.stop(callId, graceful);
      if (revoked) beginConsentReset();
      await closing;
      await adapter.stop(callId, graceful);
      expect(retain.mock.calls).toEqual([
        saved
          ? [{ durationSeconds: 52 }, captions, expect.any(Function)]
          : [{ durationSeconds: 52 }],
      ]);
    } finally {
      if (revoked) finishConsentReset();
      if (prior) NativeModules.VoiceRealtimeModule = prior;
      else delete NativeModules.VoiceRealtimeModule;
    }
  },
);

test('rejects misordered, extra fields, unbounded, and final-labeled inputs', () => {
  const first = 'live-1-1';
  const observed = {
    callId: first,
    status: 'observed_incomplete',
    lines: [
      { order: 2, role: 'user', text: 'Synthetic start' },
      { order: 4, role: 'assistant', text: 'Synthetic end' },
    ],
  };
  expect(
    parseObservedVoiceCaptions({ ...observed, status: 'final' }, first),
  ).toBeUndefined();
  expect(
    parseObservedVoiceCaptions({ ...observed, audio: 'synthetic' }, first),
  ).toBeUndefined();
  expect(
    parseObservedVoiceCaptions(
      { ...observed, lines: [...observed.lines].reverse() },
      first,
    ),
  ).toBeUndefined();
  expect(
    parseObservedVoiceCaptions(
      {
        ...observed,
        lines: [{ order: 1, role: 'user', text: 'a'.repeat(2001) }],
      },
      first,
    ),
  ).toBeUndefined();
});
