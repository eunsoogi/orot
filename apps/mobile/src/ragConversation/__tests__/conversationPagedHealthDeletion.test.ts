import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';
import type { ConversationHistoryPage } from '../conversationHistoryPage';

test('health invalidation publishes an available retry instead of restoring the stale loading snapshot', async () => {
  const f = await setup();
  let resolve!: (page: ConversationHistoryPage) => void;
  const cursor = {
    id: 'boundary',
    createdAt: '2026-11-01T00:00:00.000Z',
    kind: 'turn' as const,
    version: 0,
  };
  const read = jest
    .fn()
    .mockResolvedValueOnce({ turns: [], taskCards: [], nextCursor: cursor })
    .mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ turns: [], taskCards: [], nextCursor: null });
  const store = createConversationSessions({
    ...f.options,
    restoreSessionPage: read,
  });
  try {
    await store.synchronizeModel();
    const id = store.getSnapshot().activeId;
    const session = () =>
      store.getSnapshot().sessions.find(value => value.id === id)!;
    const pending = store.loadOlderHistory(id);
    expect(session().historyLoading).toBe(true);
    store.refreshAfterSourceDeletion('healthkit');
    expect(session().historyLoading).toBe(false);
    expect(session().historyLoadFailed).toBe(true);
    resolve({
      turns: [
        {
          question: 'deleted source input',
          answer: 'stale result',
          citations: [],
          toolMessageId: 'stale',
        },
      ],
      taskCards: [],
      nextCursor: null,
    });
    await pending;
    expect(session().messages).toEqual([]);
    await store.loadOlderHistory(id);
    expect(read.mock.calls[2]?.[2]).toEqual(cursor);
    expect(session().historyLoadFailed).toBe(false);
  } finally {
    store.dispose();
    f.store.dispose();
    f.close();
  }
});
