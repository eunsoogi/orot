import { createConversationSessions } from '../conversationSessions';
import { setup } from '../testSupport/continuousSessionFixture';

test.each([
  'Stop',
  'owned Stop',
  'model change',
  'joined Stop',
  'joined owned Stop',
])(
  '%s during an additional protected context page prevents a late model call',
  async action => {
    const f = await setup();
    let resolve!: (
      page: import('../conversationHistoryPage').ConversationHistoryPage,
    ) => void;
    let pageSignal!: AbortSignal;
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
      .mockImplementationOnce((_id: string, signal: AbortSignal) => {
        pageSignal = signal;
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
      const page = action.startsWith('joined')
        ? store.loadOlderHistory(id)
        : undefined;
      const owned = action.endsWith('owned Stop')
        ? store.sendOwnedPrompt(id, 'Synthetic owned input', sender)
        : undefined;
      const sending = owned?.completion ?? store.send(id, sender);
      await waiting;
      if (owned) expect(owned.cancel()).toBe(true);
      else if (action.endsWith('Stop')) store.cancel(id);
      else {
        f.select('different');
        await store.synchronizeModel(true);
        expect(store.getSnapshot().activeId).not.toBe(id);
      }
      expect(pageSignal.aborted).toBe(!action.startsWith('joined'));
      if (page) {
        // The cancelled send settles before the independently owned scroll read does.
        await sending;
        expect(sender).not.toHaveBeenCalled();
        expect(
          store.getSnapshot().sessions.find(session => session.id === id)
            ?.historyLoading,
        ).toBe(true);
      }
      resolve({ turns: [], taskCards: [], nextCursor: null });
      await sending;
      await page;
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
