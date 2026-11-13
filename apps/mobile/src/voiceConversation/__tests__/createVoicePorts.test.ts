import {
  createVoicePorts,
  type VoiceConversationDependencies,
} from '../createVoicePorts';

const identity = { sessionId: 1, providerId: 'provider', turnId: 'turn' };
function fixture() {
  const native = {
    start: jest.fn(),
    finishCapture: jest.fn(),
    speak: jest.fn(),
    stop: jest.fn(async () => {}),
    onInterrupted: jest.fn(),
    onListening: jest.fn(),
  };
  const deps: VoiceConversationDependencies = {
    native,
    authorize: jest.fn(async () => true),
    isCurrent: jest.fn(() => true),
    photoPending: jest.fn(() => false),
    submit: jest.fn(async () => 'answer'),
    cancel: jest.fn(async () => {}),
    language: 'ko-KR',
  };
  return { deps, native, ports: createVoicePorts(deps) };
}

test('denied consent never starts the microphone', async () => {
  const { deps, native, ports } = fixture();
  jest.mocked(deps.authorize).mockResolvedValue(false);
  const result = await ports.authorize(identity, new AbortController().signal);
  expect(result.consentProviderId).toBeNull();
  expect(native.start).not.toHaveBeenCalled();
});

test('photo added during consent revalidation prevents transmission', async () => {
  const { deps, ports } = fixture();
  jest
    .mocked(deps.photoPending)
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  await expect(
    ports.submit(identity, 'text', new AbortController().signal),
  ).rejects.toThrow();
  expect(deps.submit).not.toHaveBeenCalled();
});

test('capture cleanup still runs when request-specific cancellation fails', async () => {
  const { deps, native, ports } = fixture();
  jest.mocked(deps.cancel).mockRejectedValue(new Error('cancel failed'));
  await expect(ports.cleanup(identity, true)).rejects.toThrow();
  expect(native.stop).toHaveBeenCalledWith(identity.turnId);
});

test('listening is reported only after the native start signal and text stays within the turn', async () => {
  const { native, ports } = fixture();
  let onListening!: (turnId: string) => void;
  let finish!: (text: string) => void;
  native.onListening.mockImplementation(
    (callback: (turnId: string) => void) => {
      onListening = callback;
      return () => {};
    },
  );
  native.start.mockImplementation(
    () =>
      new Promise<string>(resolve => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = ports.authorize(identity, controller.signal);
  await Promise.resolve();
  expect(native.start).toHaveBeenCalledTimes(1);
  onListening('another-turn');
  onListening(identity.turnId);
  expect((await pending).consentProviderId).toBe(identity.providerId);
  const transcript = ports.capture(identity, controller.signal);
  finish('synthetic speech');
  expect((await transcript).text).toBe('synthetic speech');
});

test('aborting while awaiting the native permission result does not start a subsequent turn', async () => {
  const { native, ports } = fixture();
  let listener!: (turnId: string) => void;
  native.onListening.mockImplementation(
    (callback: (turnId: string) => void) => {
      listener = callback;
      return () => {};
    },
  );
  native.start.mockImplementation(() => new Promise<string>(() => {}));
  const controller = new AbortController();
  const pending = ports.authorize(identity, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow('cancelled');
  listener(identity.turnId);
  expect(native.start).toHaveBeenCalledTimes(1);
});
