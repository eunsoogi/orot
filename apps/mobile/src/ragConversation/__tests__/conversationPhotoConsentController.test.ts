import { createConversationPhotoConsentController } from '../conversationPhotoConsentController';

const details = {
  providerName: 'Synthetic',
  modelId: 'model',
  recipient: 'device',
  remoteProcessing: false,
};
test('approval is explicit and bound to the one visible provider decision', async () => {
  const controller = createConversationPhotoConsentController();
  const signal = new AbortController().signal;
  const pending = controller.confirm(details, signal);
  expect(controller.get()).toEqual(details);
  expect(await controller.confirm(details, signal)).toBe(false);
  controller.answer(true);
  expect(await pending).toBe(true);
  expect(controller.get()).toBeNull();
});

test('cancellation and owner disposal dismiss rather than authorize', async () => {
  const controller = createConversationPhotoConsentController();
  const abort = new AbortController();
  const first = controller.confirm(details, abort.signal);
  abort.abort();
  expect(await first).toBe(false);
  const second = controller.confirm(details, new AbortController().signal);
  controller.dispose();
  expect(await second).toBe(false);
});
