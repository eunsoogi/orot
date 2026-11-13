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
