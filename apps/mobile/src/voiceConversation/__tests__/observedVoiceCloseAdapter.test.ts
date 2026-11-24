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
        saved ? [{ durationSeconds: 52 }, captions] : [{ durationSeconds: 52 }],
      ]);
    } finally {
      if (revoked) finishConsentReset();
      if (prior) NativeModules.VoiceRealtimeModule = prior;
      else delete NativeModules.VoiceRealtimeModule;
    }
  },
);
