import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';

test('a restored request displays an interruption instead of an ongoing indicator', async () => {
  const update = jest.fn();
  const restoration = createConversationSessionRestoreState({
    update,
    read: async () => [
      {
        question: 'Synthetic question',
        answer: '',
        citations: [],
        completion: 'partial',
        toolMessageId: 'request',
      },
    ],
  });
  await restoration.start(1, 'session');
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({
      restoring: false,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'Synthetic question',
        }),
        expect.objectContaining({
          role: 'assistant',
          incomplete: true,
          activity: expect.stringContaining('중단'),
        }),
      ],
    }),
  );
});
