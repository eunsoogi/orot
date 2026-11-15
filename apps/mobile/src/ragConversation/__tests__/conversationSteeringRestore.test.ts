import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';

const receipt = {
  id: 's1',
  text: 'Synthetic',
  sequence: 1,
  status: 'applied' as const,
};
test('restores only the latest completed turn receipts without enabling submission', async () => {
  const update = jest.fn();
  const readSteering = jest.fn(async () => [receipt]);
  const state = createConversationSessionRestoreState({
    update,
    readSteering,
    read: async () => [
      {
        question: 'Synthetic',
        answer: 'Done',
        citations: [],
        completion: 'complete',
        toolMessageId: 'turn',
      },
    ],
  });
  await state.start(1, 'session');
  expect(readSteering).toHaveBeenCalledWith(
    'session',
    'turn',
    expect.anything(),
  );
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      steeringInstructions: [receipt],
      steeringAvailable: false,
    }),
  );
});
test('deletion during receipt restoration prevents private late publication', async () => {
  const update = jest.fn();
  let finish!: (rows: (typeof receipt)[]) => void;
  const state = createConversationSessionRestoreState({
    update,
    readSteering: () =>
      new Promise(resolve => {
        finish = resolve;
      }),
    read: async () => [
      {
        question: 'Synthetic',
        answer: 'Done',
        citations: [],
        completion: 'complete',
        toolMessageId: 'turn',
      },
    ],
  });
  const pending = state.start(1, 'session');
  await Promise.resolve();
  await Promise.resolve();
  state.forget(1);
  finish([receipt]);
  await pending;
  expect(
    update.mock.calls.some(([, change]) => change.steeringInstructions?.length),
  ).toBe(false);
});
