import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';

test('disposing while a restore is pending aborts it and suppresses its late content', async () => {
  let finish!: (
    turns: { question: string; answer: string; citations: [] }[],
  ) => void;
  let signal: AbortSignal | undefined;
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async (_id, current) => {
      signal = current;
      return new Promise(resolve => {
        finish = resolve;
      });
    },
  });
  const pending = state.start(1, 'durable');
  state.dispose();
  expect(signal?.aborted).toBe(true);
  finish([
    { question: 'stale question', answer: 'stale answer', citations: [] },
  ]);
  await pending;
  expect(update).toHaveBeenCalledTimes(1);
});
