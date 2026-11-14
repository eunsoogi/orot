import { NativeModules, Platform } from 'react-native';
import { nativeRealtimeVoice } from '../nativeRealtimeVoice';

it('retains failed cleanup across screen adapters before opening a newer call', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const stop = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic release failure'))
    .mockResolvedValue(undefined);
  const open = jest.fn().mockResolvedValue(undefined);
  NativeModules.VoiceRealtimeModule = {
    openRealtimeCall: open,
    stopRealtimeCall: stop,
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: jest.fn(),
    resumeRealtimeCall: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const previous = nativeRealtimeVoice()!;
  await expect(previous.stop('old-call')).rejects.toThrow(
    'synthetic release failure',
  );
  const next = nativeRealtimeVoice()!;
  await next.open('new-call', 'gpt-realtime-2.1', 'synthetic-key', 'ko-KR');
  expect(stop).toHaveBeenNthCalledWith(2, 'old-call');
  expect(open).toHaveBeenCalledTimes(1);
  expect(stop.mock.invocationCallOrder[1]).toBeLessThan(
    open.mock.invocationCallOrder[0],
  );
  delete NativeModules.VoiceRealtimeModule;
});

it('never opens a cancelled call after waiting for another call cleanup', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const stop = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic'))
    .mockImplementationOnce(() => gate)
    .mockResolvedValue(undefined);
  const open = jest.fn().mockResolvedValue(undefined);
  NativeModules.VoiceRealtimeModule = {
    openRealtimeCall: open,
    stopRealtimeCall: stop,
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: jest.fn(),
    resumeRealtimeCall: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const adapter = nativeRealtimeVoice()!;
  await expect(adapter.stop('blocked-old')).rejects.toThrow('synthetic');
  const pending = adapter.open(
    'cancelled-new',
    'gpt-realtime-2.1',
    'synthetic-key',
    'ko-KR',
  );
  const rejected = expect(pending).rejects.toThrow('Voice call cancelled');
  await adapter.stop('cancelled-new');
  release();
  await rejected;
  expect(open).not.toHaveBeenCalled();
  delete NativeModules.VoiceRealtimeModule;
});
