import { createConversationSessions } from '../conversationSessions';
import { getRagConversationFailureCopy } from '../copy';
import type { RagConversationOutcome } from '../service';
import type { RagConversationMessage } from '../task';

test('restores a failed prompt and excludes it from retry history', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const question = '저장된 기록을 볼 수 있나요?';
  store.setDraft(id, question);

  await store.send(id, async () => ({
    status: 'failure',
    kind: 'provider_authentication',
  }));

  const failed = store
    .getSnapshot()
    .sessions.find(session => session.id === id)!;
  expect(failed.draft).toBe(question);
  expect(failed.messages).toEqual([
    expect.objectContaining({ role: 'user', content: question, failed: true }),
  ]);
  expect(failed.error).toBe(
    getRagConversationFailureCopy('provider_authentication'),
  );

  const retryCalls: {
    question: string;
    history: readonly RagConversationMessage[];
  }[] = [];
  await store.send(id, async (retryQuestion, history) => {
    retryCalls.push({ question: retryQuestion, history });
    return {
      status: 'answer',
      answer: '저장된 범위만 확인할 수 있어요.',
      citations: [],
    };
  });

  expect(retryCalls).toEqual([{ question, history: [] }]);
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === id)
      ?.messages.map(message => message.content),
  ).toEqual([question, '저장된 범위만 확인할 수 있어요.']);
  store.dispose();
});

test('keeps failed output incomplete while preserving history and retrying once', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  store.setDraft(id, '완료된 질문');
  await store.send(id, async () => ({
    status: 'answer',
    answer: '검증된 답변',
    citations: [],
  }));

  const failedQuestion = '실패한 질문';
  store.setDraft(id, failedQuestion);
  let finish!: (result: RagConversationOutcome) => void;
  let failedHistory: readonly RagConversationMessage[] = [];
  const pending = store.send(id, (_question, history, _signal, observer) => {
    failedHistory = history;
    observer?.onTaskStreamEvent?.({
      type: 'text_delta',
      text: '검증 전 답변',
    });
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  store.setDraft(id, '보존할 새 초안');
  finish({ status: 'failure', kind: 'validation_failed' });
  await pending;

  const failed = store
    .getSnapshot()
    .sessions.find(session => session.id === id)!;
  expect(failed.draft).toBe('보존할 새 초안');
  expect(failedHistory).toEqual([
    { role: 'user', content: '완료된 질문' },
    { role: 'assistant', content: '검증된 답변' },
  ]);
  expect(failed.messages.map(message => message.content)).toEqual([
    '완료된 질문',
    '검증된 답변',
    failedQuestion,
    '검증 전 답변',
  ]);
  expect(
    failed.messages.find(message => message.content === failedQuestion),
  ).toMatchObject({ failed: true });
  expect(failed.messages.at(-1)).toMatchObject({ incomplete: true });

  let retryHistory: readonly RagConversationMessage[] = [];
  store.setDraft(id, failedQuestion);
  await store.send(id, async (_question, history) => {
    retryHistory = history;
    return {
      status: 'answer',
      answer: '재시도 답변',
      citations: [],
    };
  });

  const retried = store
    .getSnapshot()
    .sessions.find(session => session.id === id)!;
  expect(retryHistory).toEqual(failedHistory);
  expect(
    retried.messages.filter(
      message => message.role === 'user' && message.content === failedQuestion,
    ),
  ).toHaveLength(1);
  expect(
    retried.messages.find(message => message.content === '검증 전 답변'),
  ).toMatchObject({ incomplete: true });
  store.dispose();
});

test('keeps a newer cancelled retry available after the earlier turn settles late', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const firstQuestion = '첫 번째 시도';
  const retryQuestion = '다시 시도할 질문';
  store.setDraft(id, firstQuestion);
  let finishFirst!: (result: RagConversationOutcome) => void;
  const first = store.send(
    id,
    () =>
      new Promise(resolve => {
        finishFirst = resolve;
      }),
  );

  store.cancel(id);
  expect(store.getSnapshot().sessions[0]?.draft).toBe(firstQuestion);
  store.setDraft(id, retryQuestion);
  let retrySignal: AbortSignal | undefined;
  let finishRetry!: (result: RagConversationOutcome) => void;
  const retry = store.send(id, (_question, _history, signal) => {
    retrySignal = signal;
    return new Promise(resolve => {
      finishRetry = resolve;
    });
  });

  finishFirst({ status: 'answer', answer: '폐기할 첫 결과', citations: [] });
  await first;
  store.cancel(id);

  expect(retrySignal?.aborted).toBe(true);
  expect(store.getSnapshot().sessions[0]?.draft).toBe(retryQuestion);
  finishRetry({
    status: 'answer',
    answer: '폐기할 재시도 결과',
    citations: [],
  });
  await retry;
  expect(
    store
      .getSnapshot()
      .sessions[0]?.messages.some(message =>
        message.content.includes('폐기할'),
      ),
  ).toBe(false);
  store.dispose();
});
