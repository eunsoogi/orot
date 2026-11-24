import { NativeModules, Platform } from 'react-native';
import { nativeLiveVoice, nativeRealtimeVoice } from '../nativeRealtimeVoice';

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
  const outcome = pending.catch(error => error);
  await adapter.stop('cancelled-new');
  release();
  await expect(outcome).resolves.toEqual(new Error('Voice call cancelled'));
  expect(open).not.toHaveBeenCalled();
  delete NativeModules.VoiceRealtimeModule;
});

it('sends only narrow Live prefs to the new bridge and rejects an invalidated pending open', async () => {
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
  const legacy = jest.fn();
  NativeModules.VoiceRealtimeModule = {
    openLiveCall: open,
    openRealtimeCall: legacy,
    stopRealtimeCall: stop,
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: jest.fn(),
    resumeRealtimeCall: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    resolveRealtimeToolCall: jest.fn(),
    cancelRealtimeTools: jest.fn(),
  };
  const current = jest.fn(() => true);
  const adapter = nativeLiveVoice()!;
  expect(adapter.tools).toBeUndefined();
  await expect(adapter.stop('old-live')).rejects.toThrow('synthetic');
  const pending = adapter.open(
    'new-live',
    'gpt-live-1.1',
    'synthetic-key',
    '',
    false,
    { schema: 1, language: 'ko', voice: 'noeul' },
    current,
  );
  const outcome = pending.catch(error => error);
  current.mockReturnValue(false);
  release();
  await expect(outcome).resolves.toEqual(
    new Error('Expected audio-only Live settings'),
  );
  expect(open).not.toHaveBeenCalled();
  current.mockReturnValue(true);
  await adapter.open(
    'newer-live',
    'gpt-live-1.1',
    'synthetic-key',
    '',
    false,
    { schema: 1, language: 'en', voice: 'quartz' },
    current,
  );
  expect(open).toHaveBeenCalledWith(
    'newer-live',
    'gpt-live-1.1',
    'synthetic-key',
    { language: 'auto', voice: 'quartz' },
  );
  expect(legacy).not.toHaveBeenCalled();
  delete NativeModules.VoiceRealtimeModule;
});
