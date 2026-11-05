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
