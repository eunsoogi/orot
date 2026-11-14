import { createDuplexVoiceSession } from '../duplexVoiceSession';
import type {
  NativeDuplexVoice,
  DuplexTranscript,
  DuplexSpeechStart,
} from '../nativeDuplexVoice';
import type { VoiceConversationDependencies } from '../createVoicePorts';

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const identity = { sessionId: 1, providerId: 'local', turnId: 'start' };
function setup() {
  let transcript = (_: DuplexTranscript) => {};
  let started = (_: DuplexSpeechStart) => {};
  let interrupted = (_: string) => {};
  const native: NativeDuplexVoice = {
    open: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    interruptOutput: jest.fn(async () => {}),
    speak: jest.fn(async () => true),
    finishCapture: jest.fn(),
    onTranscript: listener => {
      transcript = listener;
      return jest.fn();
    },
    onSpeechStarted: listener => {
      started = listener;
      return jest.fn();
    },
    onInterrupted: listener => {
      interrupted = listener;
      return jest.fn();
    },
  };
  const deps = {
    native: { duplex: native },
    authorize: jest.fn(async () => true),
    isCurrent: jest.fn(() => true),
    photoPending: jest.fn(() => false),
    submit: jest.fn(async () => 'answer'),
    cancel: jest.fn(async () => {}),
    language: 'ko-KR',
  } as unknown as VoiceConversationDependencies;
  const session = createDuplexVoiceSession(deps, native, jest.fn());
  const callId = 'start-call-1';
  return {
    session,
    native,
    deps,
    callId,
    start: (generation: number) => started({ callId, generation }),
    say: (generation: number, text = 'hello') =>
      transcript({ callId, generation, text }),
    raw: (event: DuplexTranscript) => transcript(event),
    interrupted: () => interrupted(callId),
  };
}

test('keeps the same native call through consecutive replies without releasing capture', async () => {
  const x = setup();
  x.session.start(identity);
  await flush();
  x.start(1);
  x.say(1);
  await flush();
  expect(x.session.getState().phase).toBe('listening');
  x.start(2);
  x.say(2, 'again');
  await flush();
  expect(x.native.open).toHaveBeenCalledTimes(1);
  expect(x.native.speak).toHaveBeenCalledTimes(2);
  expect(x.native.stop).not.toHaveBeenCalled();
  x.session.stop();
  await flush();
  expect(x.native.stop).toHaveBeenCalledWith(x.callId);
});

test('barge-in preserves the new transcript and rejects old generations and late answers', async () => {
  const x = setup();
  let oldAnswer!: (value: string) => void;
  jest.mocked(x.deps.submit).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        oldAnswer = resolve;
      }),
  );
  x.session.start(identity);
  await flush();
  x.start(1);
  x.say(1);
  await flush();
  x.start(2);
  x.say(2, 'interrupt');
  await flush();
  oldAnswer('stale');
  await flush();
  x.say(1, 'late old transcript');
  x.say(2, 'duplicate');
  x.raw({ callId: 'another-call', generation: 3, text: 'foreign' });
  await flush();
  expect(x.deps.submit).toHaveBeenCalledTimes(2);
  expect(x.native.speak).toHaveBeenCalledTimes(1);
  expect(x.native.speak).toHaveBeenCalledWith(x.callId, 2, 'answer', 'ko-KR');
  expect(x.native.stop).not.toHaveBeenCalled();
});

test('does not submit after consent or attachment ownership changes', async () => {
  const x = setup();
  x.session.start(identity);
  await flush();
  jest.mocked(x.deps.photoPending).mockReturnValue(true);
  x.say(1);
  await flush();
  expect(x.deps.submit).not.toHaveBeenCalled();
  expect(x.native.stop).toHaveBeenCalledWith(x.callId);
});

test('late open cannot resurrect a stopped call or affect a resumed call', async () => {
  const x = setup();
  let opened!: () => void;
  jest.mocked(x.native.open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        opened = resolve;
      }),
  );
  x.session.start(identity);
  await flush();
  x.session.stop();
  await flush();
  x.session.resume();
  await flush();
  opened();
  await flush();
  expect(x.native.open).toHaveBeenCalledTimes(2);
  expect(x.native.stop).not.toHaveBeenCalledWith('start-call-2');
  expect(x.session.getState().phase).toBe('listening');
});

test('audio cleanup failure blocks a new owner until explicit cleanup retry', async () => {
  const x = setup();
  x.session.start(identity);
  await flush();
  jest.mocked(x.native.stop).mockRejectedValueOnce(new Error('lease'));
  x.session.stop();
  await flush();
  x.session.resume();
  expect(x.session.getState().error).toBe('cleanup');
  expect(x.native.open).toHaveBeenCalledTimes(1);
  x.session.dismissError();
  await flush();
  x.session.resume();
  await flush();
  expect(x.native.open).toHaveBeenCalledTimes(2);
});

test('native interruption cancels only this call and pending request', async () => {
  const x = setup();
  x.session.start(identity);
  await flush();
  x.interrupted();
  await flush();
  expect(x.native.stop).toHaveBeenCalledWith(x.callId);
  expect(x.session.getState().phase).toBe('error');
  x.say(1);
  await flush();
  expect(x.deps.submit).not.toHaveBeenCalled();
});

// Expected native barge-in cancellation may settle before its JS speech-start event arrives.
test('native output interruption is not treated as a fatal playback failure', async () => {
  const x = setup();
  jest.mocked(x.native.speak).mockResolvedValue(false);
  x.session.start(identity);
  await flush();
  x.say(1);
  await flush();
  expect(x.native.stop).not.toHaveBeenCalled();
  expect(x.session.getState().phase).toBe('listening');
});

test('speech arriving before open settles does not close the active call', async () => {
  const x = setup();
  let opened!: () => void;
  jest.mocked(x.native.open).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        opened = resolve;
      }),
  );
  x.session.start(identity);
  await flush();
  x.start(1);
  x.say(1);
  await flush();
  opened();
  await flush();
  expect(x.native.stop).not.toHaveBeenCalled();
  expect(x.deps.submit).toHaveBeenCalledTimes(1);
});

test('consent revoked during a provider result closes audio before any speech', async () => {
  const x = setup();
  let answer!: (text: string) => void;
  jest.mocked(x.deps.submit).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        answer = resolve;
      }),
  );
  x.session.start(identity);
  await flush();
  x.say(1);
  await flush();
  jest.mocked(x.deps.isCurrent).mockReturnValue(false);
  answer('late');
  await flush();
  expect(x.native.speak).not.toHaveBeenCalled();
  expect(x.native.stop).toHaveBeenCalledWith(x.callId);
});
