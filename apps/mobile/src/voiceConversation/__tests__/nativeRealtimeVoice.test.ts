import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { nativeLiveVoice, nativeRealtimeVoice } from '../nativeRealtimeVoice';
import { createRealtimeVoiceSession } from '../realtimeVoiceSession';

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

it('handles owned system mute separately from app mute and terminal events', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  let finishOpen!: () => void;
  const opening = new Promise<void>(done => {
    finishOpen = done;
  });
  const open = jest
    .fn<Promise<void>, [string]>()
    .mockImplementationOnce(() => opening)
    .mockResolvedValue(undefined);
  const pause = jest.fn().mockResolvedValue(undefined);
  const resume = jest.fn().mockResolvedValue(undefined);
  const graceful = jest.fn().mockResolvedValue(undefined);
  const stop = jest.fn().mockResolvedValue(undefined);
  NativeModules.VoiceRealtimeModule = {
    openLiveCall: open,
    stopRealtimeCall: stop,
    interruptRealtimeOutput: jest.fn(),
    pauseRealtimeCall: pause,
    resumeRealtimeCall: resume,
    closeLiveCall: graceful,
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  const transcript = jest.fn();
  const session = createRealtimeVoiceSession({
    native: nativeLiveVoice()!,
    model: 'gpt-live-1.1',
    liveAudioOnly: true,
    sessionId: 1,
    credentials: async () => ({
      model: 'gpt-live-1.1',
      apiKey: 'synthetic',
      preferences: { schema: 1, language: 'auto', voice: 'default' },
    }),
    isCurrent: () => true,
    changed: jest.fn(),
    transcript,
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const state = (callId: string, phase: string) =>
    DeviceEventEmitter.emit('VoiceRealtimeState', { callId, phase });
  const paused = (callId: string) =>
    DeviceEventEmitter.emit('VoiceRealtimePaused', { callId });
  try {
    session.start();
    await flush();
    const [id] = open.mock.calls[0]!;
    state(id, 'listening');
    state(id, 'stopped');
    paused('stale');
    expect(session.getState().phase).toBe('listening');
    DeviceEventEmitter.emit('VoiceRealtimeSystemCall', {
      callId: id,
      active: true,
    });
    paused(id);
    expect(session.getState().phase).toBe('stopped');
    expect(session.isSystemCallActive()).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    session.resume();
    expect(resume).toHaveBeenLastCalledWith(id);
    finishOpen();
    await flush();
    expect(stop).not.toHaveBeenCalled();
    state(id, 'listening');
    session.mute();
    await flush();
    expect(pause).toHaveBeenCalledWith(id);
    expect(session.getState().phase).toBe('stopped');
    session.stop(true);
    await flush();
    expect(graceful).toHaveBeenCalledWith(id);
    expect(stop).not.toHaveBeenCalled();
    session.start();
    await flush();
    const [next] = open.mock.calls[1]!;
    state(next, 'listening');
    paused(id);
    expect(session.getState().phase).toBe('listening');
    stop.mockRejectedValueOnce(new Error('synthetic cleanup failure'));
    DeviceEventEmitter.emit('VoiceRealtimeInterrupted', { callId: next });
    await flush();
    expect(session.getState().error).toBe('cleanup');
    state(next, 'listening');
    expect(session.getState().error).toBe('cleanup');
    DeviceEventEmitter.emit('VoiceRealtimeTranscript', {
      callId: next,
      itemId: 'late',
      role: 'assistant',
      text: 'synthetic late transcript',
    });
    expect(transcript).not.toHaveBeenCalled();
    paused(next);
    expect(session.getState().error).toBe('cleanup');
    session.resume();
    expect(resume).not.toHaveBeenCalledWith(next);
    session.stop();
    await flush();
    expect(session.getState().phase).toBe('stopped');
    expect(stop).toHaveBeenCalledWith(next);
    expect(graceful).toHaveBeenCalledTimes(1);
  } finally {
    session.dispose();
    delete NativeModules.VoiceRealtimeModule;
  }
});
