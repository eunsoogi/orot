import { createConversationSessions } from '../conversationSessions';

test('removes only the selected conversation and can undo deletion', () => {
  const store = createConversationSessions();
  store.setDraft(1, '보존할 초안');
  store.create();
  store.setDraft(2, '다른 대화');
  store.remove(1);
  expect(store.getSnapshot().sessions.map(item => item.id)).toEqual([2]);
  expect(store.getSnapshot().sessions[0]?.draft).toBe('다른 대화');
  store.undoRemove();
  expect(store.getSnapshot().sessions.map(item => item.id)).toEqual([1, 2]);
  expect(store.getSnapshot().sessions[0]?.draft).toBe('보존할 초안');
});

test('deleting the active last conversation leaves a usable new conversation', () => {
  const store = createConversationSessions();
  store.remove(1);
  const state = store.getSnapshot();
  expect(state.sessions).toHaveLength(1);
  expect(state.sessions[0]?.id).toBe(state.activeId);
  expect(state.activeId).not.toBe(1);
  store.undoRemove();
  expect(store.getSnapshot().activeId).toBe(1);
});

test('deletion stops only its request and ignores a late completion even after undo', async () => {
  const store = createConversationSessions();
  let finish!: (value: {
    status: 'answer';
    answer: string;
    citations: [];
  }) => void;
  let signal: AbortSignal | undefined;
  store.setDraft(1, '삭제할 합성 질문');
  const running = store.send(1, (_question, _history, pendingSignal) => {
    signal = pendingSignal;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  store.create();
  store.setDraft(2, '보존할 합성 질문');
  store.remove(1);
  expect(signal?.aborted).toBe(true);
  store.undoRemove();
  finish({ status: 'answer', answer: '늦은 결과', citations: [] });
  await running;
  expect(
    store
      .getSnapshot()
      .sessions.find(item => item.id === 1)
      ?.messages.some(item => item.content === '늦은 결과'),
  ).toBe(false);
  expect(store.getSnapshot().sessions.find(item => item.id === 2)?.draft).toBe(
    '보존할 합성 질문',
  );
});
