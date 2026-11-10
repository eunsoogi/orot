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

test('restores the possibilities intent with the validated conversation', async () => {
  const update = jest.fn();
  const state = createConversationSessionRestoreState({
    update,
    read: async () => [
      {
        question: '가능성을 살펴봐 주세요',
        answer: '추가 정보가 필요해요.',
        citations: [],
        entryIntent: 'possibilities' as const,
      },
    ],
  });
  await state.start(1, 'durable');
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ entryIntent: 'possibilities' }),
  );
});
