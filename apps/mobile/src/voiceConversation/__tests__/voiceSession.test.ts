import { createVoiceSession } from '../voiceSession';
import type { VoiceConversationDependencies } from '../createVoicePorts';

test('route invalidation stops an authorizing turn without submitting', async () => {
  const identity = { sessionId: 1, providerId: 'selected', turnId: 'one' };
  let valid = true;
  const native = {
    start: jest.fn(),
    finishCapture: jest.fn(),
    speak: jest.fn(),
    stop: jest.fn(async () => {}),
    onInterrupted: jest.fn(() => () => {}),
    onListening: jest.fn(() => () => {}),
  };
  const deps: VoiceConversationDependencies = {
    native,
    authorize: jest.fn(() => new Promise(() => {})),
    isCurrent: () => valid,
    photoPending: () => false,
    submit: jest.fn(),
    cancel: jest.fn(async () => {}),
    language: 'ko-KR',
  };
  const session = createVoiceSession(deps, () => {});
  session.start(identity);
  valid = false;
  session.revalidate();
  expect(session.getState().phase).toBe('cleaning');
  expect(native.stop).toHaveBeenCalledWith('one');
  expect(deps.submit).not.toHaveBeenCalled();
});

test('continuous mode reacquires only after cleanup, while mute cancels queued continuation', async () => {
  let listening: (id: string) => void = () => {};
  const captures = new Map<
    string,
    { resolve: (text: string) => void; reject: () => void }
  >();
  const native = {
    start: jest.fn(
      (id: string) =>
        new Promise<string>((resolve, reject) => {
          captures.set(id, {
            resolve,
            reject: () => reject(new Error('stopped')),
          });
          queueMicrotask(() => listening(id));
        }),
    ),
    finishCapture: jest.fn(),
    speak: jest.fn(async () => {}),
    stop: jest.fn(async (id: string) => {
      captures.get(id)?.reject();
    }),
    onInterrupted: jest.fn(() => () => {}),
    onListening: jest.fn((fn: (id: string) => void) => {
      listening = fn;
      return () => {};
    }),
  };
  const deps: VoiceConversationDependencies = {
    native,
    authorize: async () => true,
    isCurrent: () => true,
    photoPending: () => false,
    submit: async () => 'answer',
    cancel: async () => {},
    language: 'ko-KR',
  };
  const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const session = createVoiceSession(deps, () => {});
  session.start({ sessionId: 1, providerId: 'selected', turnId: 'call' });
  await flush();
  captures.get('call')!.resolve('question');
  await flush();
  expect(native.start).toHaveBeenCalledTimes(2);
  expect(native.stop).toHaveBeenCalledWith('call');
  const next = native.start.mock.calls[1][0];
  expect(next).not.toBe('call');
  session.stop();
  await flush();
  expect(session.getState().phase).toBe('stopped');
  expect(native.start).toHaveBeenCalledTimes(2);
  session.resume();
  await flush();
  expect(native.start).toHaveBeenCalledTimes(3);
  session.dispose();
  await flush();
  expect(native.start).toHaveBeenCalledTimes(3);
});
