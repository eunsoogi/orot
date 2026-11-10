import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';
import { createConversationSessions } from '../conversationSessions';

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

test.each([[[]], [[{ question: '', answer: '', citations: [] }]]])(
  'does not enable follow-up without a committed turn',
  async turns => {
    const update = jest.fn();
    const state = createConversationSessionRestoreState({
      update,
      read: async () => turns,
    });
    await state.start(1, 'saved');
    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ restoreFailed: true }),
    );
  },
);

test('an empty restored session cannot dispatch a follow-up', async () => {
  const retention = {
    attachExisting: async () => {},
    activeIdentity: () => 'saved',
    activeLease: () => null,
    invalidate: () => {},
  };
  const sessions = createConversationSessions({
    retention: retention as never,
    restoreSession: async () => [],
  });
  const id = await sessions.attachExisting(
    'saved',
    0,
    '2026-10-05T00:00:00.000Z',
  );
  sessions.setDraft(id, 'follow-up');
  const send = jest.fn();
  await sessions.send(id, send);
  expect(send).not.toHaveBeenCalled();
  sessions.dispose();
});
