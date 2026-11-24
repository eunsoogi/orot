import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { nativeLiveVoice } from '../nativeRealtimeVoice';
import { createRealtimeVoiceSession } from '../realtimeVoiceSession';

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

it.each(['gpt-6-luna', 'gpt-6-sol'])(
  'routes selected %s to the Live bridge without changing the audio model',
  async backendModel => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    const open = jest.fn().mockResolvedValue(undefined);
    NativeModules.VoiceRealtimeModule = {
      openLiveCall: open,
      stopRealtimeCall: jest.fn(),
      interruptRealtimeOutput: jest.fn(),
      pauseRealtimeCall: jest.fn(),
      resumeRealtimeCall: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    try {
      const generation = 'a'.repeat(64);
      const receipt = Object.freeze({
        backendModel,
        generation,
        grantID: generation + '-model',
      });
      const selected = jest.fn(() => receipt);
      const adapter = nativeLiveVoice(undefined, selected)!;
      await adapter.open(
        'approved',
        'gpt-live-1.1',
        'synthetic-key',
        '',
        false,
        { schema: 1, language: 'ko', voice: 'noeul' },
        () => true,
      );
      expect(selected).toHaveBeenCalledWith('approved');
      expect(open).toHaveBeenCalledWith(
        'approved',
        'gpt-live-1.1',
        'synthetic-key',
        { language: 'auto', voice: 'noeul', responsesGrant: receipt },
      );
      selected.mockImplementation(() => {
        throw new Error('Revoked choice');
      });
      await expect(
        adapter.open(
          'revoked',
          'gpt-live-1.1',
          'synthetic-key',
          '',
          false,
          { schema: 1, language: 'ko', voice: 'noeul' },
          () => true,
        ),
      ).rejects.toThrow('Revoked choice');
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      delete NativeModules.VoiceRealtimeModule;
    }
  },
);
