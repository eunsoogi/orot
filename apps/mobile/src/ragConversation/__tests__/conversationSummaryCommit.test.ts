import { createConversationSessions } from '../conversationSessions';
import type { RagConversationOutcome } from '../outcome';

test.each([true, false])(
  'cancellation waits for summary write and respects commit=%s',
  async committed => {
    const store = createConversationSessions();
    store.setDraft(1, '요약 요청');
    let finish!: () => void;
    const pending = store.send(
      1,
      async (_question, _history, _signal, observer) => {
        observer?.onSummarySaveStart?.();
        await new Promise<void>(resolve => {
          finish = resolve;
        });

        observer?.onSummarySaveSettled?.(committed);
        return (
          committed
            ? { status: 'answer', answer: '저장된 요약', citations: [] }
            : { status: 'failure', kind: 'cancelled' }
        ) as RagConversationOutcome;
      },
    );
    store.cancel(1);
    expect(store.getSnapshot().sessions[0]?.busy).toBe(true);
    finish();
    await pending;
    const session = store.getSnapshot().sessions[0]!;
    expect(session.busy).toBe(false);
    expect(
      session.messages.some(message => message.content === '저장된 요약'),
    ).toBe(committed);
    if (!committed) expect(session.draft).toBe('요약 요청');
    store.dispose();
  },
);

test('cancelling a new summary keeps the previous saved summary visible', async () => {
  const store = createConversationSessions();
  const healthSummary = {
    reference: {
      summaryId: 'old',
      window: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-05T00:00:00Z',
        timeZone: 'UTC',
      },
    },
    analysis: {
      hypotheses: [],
      savedSummary: {
        status: 'saved' as const,
        id: 'old',
        createdAt: '2026-10-05T00:00:00Z',
        modelName: 'Model',
      },
    },
  };
  store.setDraft(1, '첫 요약');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '이전 요약',
    citations: [],
    healthSummary,
  }));
  store.setDraft(1, '새 요약');
  let finish!: () => void;
  const pending = store.send(1, async () => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    return { status: 'failure', kind: 'cancelled' };
  });
  store.cancel(1);
  finish();
  await pending;
  expect(
    store
      .getSnapshot()
      .sessions[0]!.messages.some(message => message.content === '이전 요약'),
  ).toBe(true);
  store.dispose();
});
