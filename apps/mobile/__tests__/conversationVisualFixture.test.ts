import {
  sendSyntheticConversation,
  syntheticConversationAnswer,
} from '../e2e/conversationVisualFixture';

test('local completed output keeps its streamed text and explicit synthetic citation', async () => {
  const onTaskStreamEvent = jest.fn();
  const result = await sendSyntheticConversation(
    'complete synthetic',
    [],
    new AbortController().signal,
    { onTaskStreamEvent },
  );
  expect(onTaskStreamEvent).toHaveBeenLastCalledWith({
    type: 'text_delta',
    text: syntheticConversationAnswer,
  });
  expect(result).toMatchObject({
    status: 'answer',
    answer: syntheticConversationAnswer,
    citations: [expect.objectContaining({ sourceKind: 'personal_record' })],
  });
});

test('pending output waits for actual cancellation rather than a fixture timer', async () => {
  const controller = new AbortController();
  let settled = false;
  const pending = sendSyntheticConversation(
    'pending synthetic',
    [],
    controller.signal,
  ).then(result => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  controller.abort();
  await expect(pending).resolves.toEqual({ status: 'unavailable' });
});

test('failure has no successful text or citation event', async () => {
  const onTaskStreamEvent = jest.fn();
  await expect(
    sendSyntheticConversation('failure synthetic', [], undefined, {
      onTaskStreamEvent,
    }),
  ).resolves.toEqual({ status: 'unavailable' });
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
});
