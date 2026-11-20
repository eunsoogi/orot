import { NativeModules, Platform, type NativeEventEmitter } from 'react-native';
import {
  nativeDuplexVoice,
  type DuplexNativeModule,
} from '../nativeDuplexVoice';
import { nativeLiveVoice } from '../nativeRealtimeVoice';
import { createVoiceEndReceipt } from '../voiceEndReceipt';

test('the production Live adapter preserves an old stop receipt when a new owner retries cleanup', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const old = 'realtime-99-1';
  const next = 'realtime-99-2';
  const prior = NativeModules.VoiceRealtimeModule;
  const finish = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic old audio release failure'))
    .mockImplementation(async (id: string) => ({
      callId: id,
      durationSeconds: id === old ? 134 : 62,
    }));
  const open = jest.fn(async () => {});
  NativeModules.VoiceRealtimeModule = {
    openLiveCall: open,
    closeLiveCall: finish,
    stopRealtimeCall: finish,
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: jest.fn(),
    resumeRealtimeCall: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const storeOld = jest.fn(async () => {});
  const storeNext = jest.fn(async () => {});
  const capture = (retain: typeof storeOld) => (callId: string) =>
    createVoiceEndReceipt({ callId, isCurrent: () => true, retain }).accept;
  const preferences = { schema: 1, language: 'ko', voice: 'noeul' } as const;
  try {
    const previous = nativeLiveVoice(capture(storeOld))!;
    await previous.open(
      old,
      'gpt-live-1.1',
      'synthetic-key',
      '',
      false,
      preferences,
      () => true,
    );
    await expect(previous.stop(old, true)).rejects.toThrow(
      'synthetic old audio release failure',
    );
    const replacement = nativeLiveVoice(capture(storeNext))!;
    await replacement.open(
      next,
      'gpt-live-1.1',
      'synthetic-key',
      '',
      false,
      preferences,
      () => true,
    );
    expect(storeOld).toHaveBeenCalledWith({ durationSeconds: 134 });
    expect(storeNext).not.toHaveBeenCalled();
    expect(finish).toHaveBeenNthCalledWith(2, old);
    expect(finish.mock.invocationCallOrder[1]).toBeLessThan(
      open.mock.invocationCallOrder[1]!,
    );
    await replacement.stop(next, true);
    await replacement.stop(next, true);
    expect(storeOld).toHaveBeenCalledTimes(1);
    expect(storeNext).toHaveBeenCalledTimes(1);
    expect(storeNext).toHaveBeenCalledWith({ durationSeconds: 62 });
  } finally {
    if (prior) NativeModules.VoiceRealtimeModule = prior;
    else delete NativeModules.VoiceRealtimeModule;
  }
});

test('the production local duplex adapter uses the terminal result rather than the opened phase', async () => {
  const id = 'voice-99-1-call-1';
  const persist = jest.fn(async () => {});
  const stopCall = jest
    .fn()
    .mockResolvedValue({ callId: id, durationSeconds: 65 });
  const module: DuplexNativeModule = {
    openCall: jest.fn(async () => {}),
    stopCall,
    interruptOutput: jest.fn(async () => {}),
    speakCall: jest.fn(async () => true),
    finishCallCapture: jest.fn(),
  };
  const adapter = nativeDuplexVoice(
    module,
    {} as NativeEventEmitter,
    callId =>
      createVoiceEndReceipt({ callId, isCurrent: () => true, retain: persist })
        .accept,
  );
  await adapter.open(id, 'ko');
  expect(persist).not.toHaveBeenCalled();
  await adapter.stop(id);
  await adapter.stop(id);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledWith({ durationSeconds: 65 });
});
