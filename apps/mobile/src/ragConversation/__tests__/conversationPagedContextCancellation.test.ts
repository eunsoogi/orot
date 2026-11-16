import { createConversationSessions } from '../conversationSessions';
import { setup } from './continuousSessionFixture';

test.each(['Stop', 'model change'])(
  '%s during an additional protected context page prevents a late model call',
  async action => {
    const f = await setup();
    let resolve!: (
      page: import('../conversationHistoryPage').ConversationHistoryPage,
    ) => void;
    let started!: () => void;
    const waiting = new Promise<void>(done => {
      started = done;
    });
    const restoreSessionPage = jest
      .fn()
      .mockResolvedValueOnce({
        turns: [],
        taskCards: [],
        nextCursor: {
          id: 'boundary',
          createdAt: '2026-11-01T00:00:00.000Z',
          kind: 'turn',
          version: 0,
        },
      })
      .mockImplementationOnce(() => {
        started();
        return new Promise(done => {
          resolve = done;
        });
      })
      .mockResolvedValueOnce({ turns: [], taskCards: [], nextCursor: null });
    const store = createConversationSessions({
      ...f.options,
      restoreSessionPage,
    });
    try {
      await store.synchronizeModel();
      const id = store.getSnapshot().activeId;
      const sender = jest.fn(async () => ({ status: 'unavailable' as const }));
      store.setDraft(id, 'Synthetic user input');
      const sending = store.send(id, sender);
      await waiting;
      if (action === 'Stop') store.cancel(id);
      else {
        f.select('different');
        await store.synchronizeModel(true);
        expect(store.getSnapshot().activeId).not.toBe(id);
      }
      resolve({ turns: [], taskCards: [], nextCursor: null });
      await sending;
      expect(sender).not.toHaveBeenCalled();
      expect(
        store.getSnapshot().sessions.find(session => session.id === id)?.draft,
      ).toBe('Synthetic user input');
    } finally {
      store.dispose();
      f.store.dispose();
      f.close();
    }
  },
);
