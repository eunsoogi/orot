import { createConversationSessions } from '../conversationSessions';
import type { RagConversationOutcome } from '../service';
import type { RagConversationMessage } from '../task';

test('keeps pending answers and histories with their originating session when switching', async () => {
  const store = createConversationSessions();
  const first = store.getSnapshot().activeId;
  store.setDraft(first, '첫 합성 질문');
  let finish!: (result: RagConversationOutcome) => void;
  const sendFirst = store.send(
    first,
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  store.create();
  const second = store.getSnapshot().activeId;
  store.setDraft(second, '두 번째 합성 질문');
  const sendSecond = jest.fn(
    async (_question: string, _history: readonly RagConversationMessage[]) => ({
      status: 'answer' as const,
      answer: '두 번째 답변',
      citations: [],
    }),
  );
  await store.send(second, sendSecond);
  expect(sendSecond.mock.calls[0]?.[1]).toEqual([]);
  finish({ status: 'answer', answer: '첫 번째 답변', citations: [] });
  await sendFirst;
  expect(store.getSnapshot().activeId).toBe(second);
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === second)
      ?.messages.map(message => message.content),
  ).toEqual(['두 번째 합성 질문', '두 번째 답변']);
  store.select(first);
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === first)
      ?.messages.map(message => message.content),
  ).toEqual(['첫 합성 질문', '첫 번째 답변']);
  store.dispose();
});

test('explicit stop cancels only its session and discards a late answer', async () => {
  const store = createConversationSessions();
  const first = store.getSnapshot().activeId;
  store.setDraft(first, '중지할 합성 질문');
  let signal: AbortSignal | undefined;
  let finish!: (result: RagConversationOutcome) => void;
  const pending = store.send(first, (_question, _history, current) => {
    signal = current;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  store.create();
  const second = store.getSnapshot().activeId;
  store.setDraft(second, '보존할 합성 초안');
  store.cancel(first);
  expect(signal?.aborted).toBe(true);
  finish({ status: 'answer', answer: '버려야 할 늦은 답변', citations: [] });
  await pending;
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === first)
      ?.messages.some(message => message.content === '버려야 할 늦은 답변'),
  ).toBe(false);
  expect(
    store.getSnapshot().sessions.find(session => session.id === second)?.draft,
  ).toBe('보존할 합성 초안');
  store.dispose();
});
