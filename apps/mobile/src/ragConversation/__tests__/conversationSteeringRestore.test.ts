import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';

const receipt = {
  id: 's1',
  text: 'Synthetic',
  sequence: 1,
  status: 'applied' as const,
};
test.each(['complete', 'partial', undefined] as const)(
  'restores validated answer receipts independently of legacy coverage (%s)',
  async completion => {
    const update = jest.fn();
    const readSteering = jest.fn(async (_session, request) => [
      { ...receipt, id: request },
    ]);
    const state = createConversationSessionRestoreState({
      update,
      readSteering,
      read: async () => [
        {
          question: 'Synthetic',
          answer: 'Done',
          citations: [],
          completion,
          toolMessageId: 'turn',
        },
        {
          question: 'Next',
          answer: 'Next answer',
          citations: [],
          completion,
          toolMessageId: 'turn2',
        },
      ],
    });
    await state.start(1, 'session');
    expect(readSteering).toHaveBeenCalledWith(
      'session',
      'turn',
      expect.anything(),
    );
    expect(readSteering).toHaveBeenCalledWith(
      'session',
      'turn2',
      expect.anything(),
    );
    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        steeringInstructions: [],
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            steeringInstructions: [{ ...receipt, id: 'turn' }],
          }),
        ]),
        steeringAvailable: false,
      }),
    );
  },
);
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
    update.mock.calls.some(([, change]) =>
      change.messages?.some(
        (m: { steeringInstructions?: unknown[] }) =>
          m.steeringInstructions?.length,
      ),
    ),
  ).toBe(false);
});
