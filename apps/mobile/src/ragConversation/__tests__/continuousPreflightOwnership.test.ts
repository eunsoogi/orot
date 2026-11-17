import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

const empty: ConversationHistoryPage = {
  turns: [],
  taskCards: [],
  nextCursor: null,
};
const cursor = {
  id: 'older',
  createdAt: '2026-11-01T00:00:00Z',
  kind: 'turn' as const,
  version: 0,
};
const sender = () =>
  jest.fn(async () => ({
    status: 'answer' as const,
    answer: 'Synthetic answer',
    citations: [],
  }));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('eight metadata-only unavailable notices do not satisfy context or retrieve steering receipts', async () => {
  const f = await setup();
  const read = jest
    .fn()
    .mockResolvedValueOnce({
      ...empty,
      nextCursor: cursor,
      turns: Array.from({ length: 8 }, (_, i) => ({
        question: '',
        answer: 'Synthetic unavailable',
        citations: [],
        historyUnavailable: true,
        toolMessageId: `notice-${i}`,
      })),
    })
    .mockResolvedValue(empty);
  const steering = jest.fn(async () => []);
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
    restoreSteering: steering,
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const send = sender();
    store.setDraft(id, 'Synthetic current input');
    await store.send(id, send);
    expect(read).toHaveBeenCalledTimes(2);
    expect(steering).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.anything(),
      expect.anything(),
    );
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});

test.each(['model', 'history'] as const)(
  'synchronous subscriber Stop during %s publication cannot strand a cancelled flight',
  async stage => {
    const f = await setup();
    const read = jest
      .fn()
      .mockResolvedValueOnce({ ...empty, nextCursor: cursor })
      .mockResolvedValue(empty);
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage: read,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const current = () =>
        store.getSnapshot().sessions.find(s => s.id === id)!;
      let stopped = false;
      const unsubscribe = store.subscribe(() => {
        if (
          !stopped &&
          current().preparingSend &&
          (stage === 'model'
            ? current().modelSelectionPending
            : current().historyLoading)
        ) {
          stopped = true;
          store.cancel(id);
        }
      });
      const send = sender();
      store.setDraft(id, 'Synthetic reentrant stop');
      await store.send(id, send);
      expect(stopped).toBe(true);
      expect(send).not.toHaveBeenCalled();
      expect(current().preparingSend).toBe(false);
      expect(current().modelSelectionPending).toBe(false);
      unsubscribe();
      await store.send(id, send);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);

test.each(['clear', 'dispose'] as const)(
  '%s releases preflight and a late failed read cannot publish or dispatch',
  async mode => {
    const f = await setup();
    let reject!: (error: Error) => void;
    const read = jest
      .fn()
      .mockResolvedValueOnce({ ...empty, nextCursor: cursor })
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      );
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage: read,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const send = sender();
      store.setDraft(id, 'Synthetic pending input');
      const pending = store.send(id, send);
      for (let i = 0; i < 30 && read.mock.calls.length < 2; i++) await tick();
      expect(read).toHaveBeenCalledTimes(2);
      if (mode === 'clear') store.invalidateAll();
      else store.dispose();
      await pending;
      const snapshot = store.getSnapshot();
      reject(new Error('Synthetic late storage failure'));
      await tick();
      expect(store.getSnapshot()).toEqual(snapshot);
      expect(send).not.toHaveBeenCalled();
    } finally {
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);

test('a reentrant replacement keeps its preparing owner when the older request starts and is stopped', async () => {
  const f = await setup();
  let replacement: Promise<void> | undefined;
  try {
    await f.store.synchronizeModel();
    const id = f.store.getSnapshot().activeId;
    const current = () =>
      f.store.getSnapshot().sessions.find(s => s.id === id)!;
    const original = f.options.continuousSession;
    let calls = 0;
    let release!: () => void;
    f.options.continuousSession = async signal => {
      if (++calls === 2)
        await new Promise<void>(resolve => {
          release = resolve;
        });
      return original(signal);
    };
    const send = sender();
    let replaced = false;
    const unsubscribe = f.store.subscribe(() => {
      if (!replaced && current().busy) {
        replaced = true;
        f.store.cancel(id);
        f.store.setDraft(id, 'Synthetic replacement');
        replacement = f.store.send(id, send);
      }
    });
    f.store.setDraft(id, 'Synthetic first input');
    const first = f.store.send(id, send);
    for (let i = 0; i < 30 && !release; i++) await tick();
    expect(replaced).toBe(true);
    expect(current().preparingSend).toBe(true);
    release();
    await first;
    await replacement;
    expect(current().preparingSend).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    unsubscribe();
  } finally {
    f.store.dispose();
    f.close();
  }
});
