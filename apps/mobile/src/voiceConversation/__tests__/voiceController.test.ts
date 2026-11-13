import { createVoiceController, type VoicePorts } from '../voiceController';
import type { VoiceEvent } from '../voiceTurn';

const identity = { sessionId: 4, providerId: 'selected', turnId: 'a' };
const authorized: Extract<VoiceEvent, { type: 'authorized' }> = {
  type: 'authorized',
  identity,
  microphone: true,
  speech: true,
  onDevice: true,
  consentProviderId: 'selected',
};
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};

test('late microphone result after stop cannot submit and cleanup fences reacquisition', async () => {
  let finishCapture!: (
    event: Extract<VoiceEvent, { type: 'transcript' }>,
  ) => void;
  const capture = new Promise<Extract<VoiceEvent, { type: 'transcript' }>>(
    resolve => {
      finishCapture = resolve;
    },
  );
  const ports: VoicePorts = {
    authorize: jest.fn(async () => authorized),
    capture: jest.fn(() => capture),
    submit: jest.fn(async () => 'answer'),
    speak: jest.fn(async () => {}),
    cleanup: jest.fn(async () => {}),
  };
  const controller = createVoiceController(ports, () => {});
  controller.dispatch({ type: 'start', identity });
  await flush();
  expect(controller.getState().phase).toBe('listening');
  controller.dispatch({ type: 'stop', identity });
  finishCapture({
    type: 'transcript',
    identity,
    text: 'hello',
    currentProviderId: 'selected',
    consentProviderId: 'selected',
    photoPending: false,
  });
  await flush();
  expect(ports.submit).not.toHaveBeenCalled();
  expect(ports.cleanup).toHaveBeenCalledTimes(2);
  expect(controller.getState().phase).toBe('stopped');
});

test('cleanup failure blocks restart until cleanup succeeds', async () => {
  const cleanup = jest
    .fn()
    .mockRejectedValueOnce(new Error('release'))
    .mockResolvedValue(undefined);
  const ports: VoicePorts = {
    authorize: jest.fn(async () => ({ ...authorized, microphone: false })),
    capture: jest.fn(),
    submit: jest.fn(),
    speak: jest.fn(),
    cleanup,
  };
  const controller = createVoiceController(ports, () => {});
  controller.dispatch({ type: 'start', identity });
  await flush();
  expect(controller.getState()).toMatchObject({
    phase: 'error',
    error: 'cleanup',
  });
  controller.dispatch({
    type: 'start',
    identity: { ...identity, turnId: 'b' },
  });
  expect(controller.getState().error).toBe('cleanup');
  controller.dispatch({ type: 'retryCleanup', identity });
  await flush();
  expect(controller.getState().phase).toBe('stopped');
});

test('a synchronous observer can stop before capture starts', async () => {
  const ports: VoicePorts = {
    authorize: jest.fn(async () => authorized),
    capture: jest.fn(),
    submit: jest.fn(),
    speak: jest.fn(),
    cleanup: jest.fn(async () => {}),
  };
  const controller = createVoiceController(ports, state => {
    if (state.phase === 'listening')
      controller.dispatch({ type: 'stop', identity });
  });
  controller.dispatch({ type: 'start', identity });
  await flush();
  expect(ports.capture).not.toHaveBeenCalled();
  expect(controller.getState().phase).toBe('stopped');
});
