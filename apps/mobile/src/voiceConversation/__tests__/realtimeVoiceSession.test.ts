import { createRealtimeVoiceSession } from '../realtimeVoiceSession';
import type { NativeRealtimeVoice } from '../nativeRealtimeVoice';
import type { VoicePhase } from '../voiceTurn';

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  let stateEvent: (id: string, phase: VoicePhase) => void = () => {};
  let interrupted: (id: string) => void = () => {};
  const native: NativeRealtimeVoice = {
    open: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    pause: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    interrupt: jest.fn(async () => {}),
    onState: listener => {
      stateEvent = listener;
      return jest.fn();
    },
    onTranscript: jest.fn(() => jest.fn()),
    onInterrupted: listener => {
      interrupted = listener;
      return jest.fn();
    },
  };
  const credentials = jest.fn(async () => ({
    model: 'gpt-realtime-2.1',
    apiKey: 'synthetic-test-key',
  }));
  let current = true;
  const changed = jest.fn();
  const session = createRealtimeVoiceSession({
    native,
    model: 'gpt-realtime-2.1',
    sessionId: 7,
    credentials,
    isCurrent: () => current,
    changed,
    transcript: jest.fn(),
  });
  return {
    session,
    native,
    credentials,
    changed,
    state: (id: string, phase: VoicePhase) => stateEvent(id, phase),
    interrupt: (id: string) => interrupted(id),
    invalidate: () => {
      current = false;
    },
  };
}

it('opens only after explicit start and never invokes a text provider', async () => {
  const f = fixture();
  expect(f.native.open).not.toHaveBeenCalled();
  f.session.start();
  await flush();
  expect(f.native.open).toHaveBeenCalledWith(
    expect.any(String),
    'gpt-realtime-2.1',
    'synthetic-test-key',
    'ko-KR',
  );
  const id = (f.native.open as jest.Mock).mock.calls[0][0];
  f.state(id, 'speaking');
  expect(f.session.getState().phase).toBe('speaking');
  f.session.interrupt();
  expect(f.native.interrupt).toHaveBeenCalledWith(id);
  f.session.stop();
  await flush();
  expect(f.session.getState().phase).toBe('stopped');
  f.state(id, 'speaking');
  expect(f.session.getState().phase).toBe('stopped');
});
it('does not open a changed model or silently fall back', async () => {
  const f = fixture();
  f.credentials.mockResolvedValue({ model: 'other', apiKey: 'synthetic' });
  f.session.start();
  await flush();
  expect(f.native.open).not.toHaveBeenCalled();
  expect(f.session.getState().error).toBe('consent');
});
it('stops when route validity changes while credentials are loading', async () => {
  const f = fixture();
  let resolve!: (value: { model: string; apiKey: string }) => void;
  f.credentials.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  f.session.start();
  f.invalidate();
  resolve({ model: 'gpt-realtime-2.1', apiKey: 'synthetic' });
  await flush();
  expect(f.native.open).not.toHaveBeenCalled();
  expect(f.session.getState().phase).toBe('error');
  expect(f.session.getState().error).toBe('consent');
});
it('closes a late open after end without resurrecting the call', async () => {
  const f = fixture();
  let opened!: () => void;
  (f.native.open as jest.Mock).mockImplementation(
    () =>
      new Promise<void>(done => {
        opened = done;
      }),
  );
  f.session.start();
  await flush();
  f.session.stop();
  await flush();
  opened();
  await flush();
  expect(f.native.stop).toHaveBeenCalledTimes(2);
  expect(f.session.getState().phase).toBe('stopped');
});
it('retains failed cleanup ownership and retries rather than reopening', async () => {
  const f = fixture();
  (f.native.stop as jest.Mock).mockRejectedValueOnce(
    new Error('synthetic release failure'),
  );
  f.session.start();
  await flush();
  f.session.stop();
  await flush();
  expect(f.session.getState().error).toBe('cleanup');
  f.session.resume();
  expect(f.native.open).toHaveBeenCalledTimes(1);
  f.session.stop();
  await flush();
  expect(f.session.getState().phase).toBe('stopped');
});
it('disposal invalidates credential acquisition and subscriptions', async () => {
  const f = fixture();
  f.session.start();
  f.session.dispose();
  await flush();
  expect(f.native.open).not.toHaveBeenCalled();
  f.session.resume();
  expect(f.native.open).not.toHaveBeenCalled();
});

it('mutes capture and resumes the same remote session without reopening or credentials', async () => {
  const f = fixture();
  f.session.start();
  await flush();
  const id = (f.native.open as jest.Mock).mock.calls[0][0];
  f.state(id, 'listening');
  f.session.mute();
  await flush();
  expect(f.native.pause).toHaveBeenCalledWith(id);
  expect(f.session.getState().phase).toBe('stopped');
  f.state(id, 'speaking');
  expect(f.session.getState().phase).toBe('stopped');
  f.session.resume();
  await flush();
  expect(f.native.resume).toHaveBeenCalledWith(id);
  expect(f.native.open).toHaveBeenCalledTimes(1);
  expect(f.credentials).toHaveBeenCalledTimes(1);
  expect(f.native.stop).not.toHaveBeenCalled();
  f.state(id, 'listening');
  expect(f.session.getState().phase).toBe('listening');
  f.session.stop();
  await flush();
  expect(f.native.stop).toHaveBeenCalledWith(id);
});
