import { createConversationSessions } from '../conversationSessions';
import type { RagConversationOutcome } from '../service';
import type { RagConversationMessage } from '../task';

test('an explicit failed prompt preserves the composer draft', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const prompt = '다음 진료 질문을 준비해 주세요';
  const draft = '제가 작성 중인 대화';
  store.setDraft(id, draft);
  const observedDrafts: string[] = [];
  const unsubscribe = store.subscribe(() => {
    observedDrafts.push(
      store.getSnapshot().sessions.find(session => session.id === id)?.draft ??
        '',
    );
  });

  const send = jest.fn(async () => ({
    status: 'failure' as const,
    kind: 'provider_refused' as const,
  }));
  await store.sendPrompt(id, prompt, send);

  const session = store.getSnapshot().sessions.find(item => item.id === id)!;
  expect(send).toHaveBeenCalledWith(
    prompt,
    [],
    expect.any(AbortSignal),
    expect.any(Object),
  );
  expect(session.draft).toBe(draft);
  expect(session.messages).toContainEqual(
    expect.objectContaining({
      role: 'user',
      content: prompt,
      failed: true,
    }),
  );
  expect(observedDrafts).not.toContain(prompt);

  unsubscribe();
  store.dispose();
});

test('a cancelled explicit prompt stays out of the composer and can be retried', async () => {
  const store = createConversationSessions();
  const id = store.getSnapshot().activeId;
  const prompt = '진료 질문을 다시 준비해 주세요';
  const draft = '보존할 작성 중 메시지';
  store.setDraft(id, draft);
  const observedDrafts: string[] = [];
  const unsubscribe = store.subscribe(() => {
    observedDrafts.push(
      store.getSnapshot().sessions.find(session => session.id === id)?.draft ??
        '',
    );
  });

  let signal: AbortSignal | undefined;
  let completeFirst!: (outcome: RagConversationOutcome) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const running = store.sendPrompt(
    id,
    prompt,
    (_question, _history, current) => {
      signal = current;
      entered();
      return new Promise<RagConversationOutcome>(resolve => {
        completeFirst = resolve;
      });
    },
  );
  await started;

  const active = store.getSnapshot().sessions.find(item => item.id === id)!;
  expect(active.draft).toBe(draft);
  expect(active.busy).toBe(true);
  expect(active.pendingMessage).not.toBeNull();
  expect(active.messages).toContainEqual(
    expect.objectContaining({ role: 'user', content: prompt }),
  );

  store.cancel(id);
  expect(signal?.aborted).toBe(true);
  expect(store.getSnapshot().sessions.find(item => item.id === id)?.draft).toBe(
    draft,
  );
  completeFirst({
    status: 'answer',
    answer: '무시할 늦은 답변',
    citations: [],
  });
  await running;
  expect(
    store
      .getSnapshot()
      .sessions.find(item => item.id === id)
      ?.messages.some(message => message.content === '무시할 늦은 답변'),
  ).toBe(false);

  const retries: {
    question: string;
    history: readonly RagConversationMessage[];
  }[] = [];
  await store.sendPrompt(id, prompt, async (question, history) => {
    retries.push({ question, history });
    return {
      status: 'answer',
      answer: '준비된 질문',
      citations: [],
    };
  });

  const session = store.getSnapshot().sessions.find(item => item.id === id)!;
  expect(retries).toEqual([{ question: prompt, history: [] }]);
  expect(session.draft).toBe(draft);
  expect(
    session.messages.filter(
      message => message.role === 'user' && message.content === prompt,
    ),
  ).toHaveLength(1);
  expect(observedDrafts).not.toContain(prompt);

  unsubscribe();
  store.dispose();
});
