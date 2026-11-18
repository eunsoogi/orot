import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { conversationHistoryPageOption } from '../../aiFeatures/integration/conversationHistoryPageOption';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';

/** Real SQLite restore guards remain authoritative; only the model transport is synthetic. */
test('after A to B to A, old saved text is readable without entering either new model context', async () => {
  const f = await quarantinedHistoryFixture();
  let selected = 'a';
  let counter = 0;
  const readPage = jest.fn(conversationHistoryPageOption(f.input, f.open));
  const store = createConversationSessions({
    continuousSession: async signal => ({
      ...(await f.storage.continuousSession(
        { providerId: 'synthetic', modelId: selected },
        `epoch-${++counter}`,
        '2026-11-16T00:00:00.000Z',
        signal,
      )),
      model: { providerId: 'synthetic', modelId: selected },
    }),
    retention: createConversationSessionRetention({
      openStorage: async () => f.storage,
      createId: () => `new-${++counter}`,
      now: () => '2026-11-16T00:00:00.000Z',
    }),
    restoreSession: async () => [],
    restoreSessionPage: readPage,
    listSessions: cursor => f.storage.listSessions(cursor),
  });
  try {
    await store.synchronizeModel();
    const old = store.toolSourceSessionId(store.getSnapshot().activeId)!;
    selected = 'b';
    await store.synchronizeModel(true);
    const current = store.getSnapshot();
    expect(
      current.sessions.find(item => item.id === current.activeId)!.messages,
    ).toEqual([]);
    const reads = readPage.mock.calls.length;
    await store.archive.list();
    expect(readPage.mock.calls).toHaveLength(reads); // Listing does not eagerly hydrate every epoch.
    await store.archive.select(old);
    expect(
      store.archive.getSnapshot().lines.map(line => line.content),
    ).toContain('Synthetic older answer');
    expect(store.getSnapshot()).toBe(current);
    const sender = jest.fn<
      ReturnType<ConversationSender>,
      Parameters<ConversationSender>
    >(async () => ({
      status: 'answer',
      answer: 'Synthetic B answer',
      citations: [],
    }));
    store.setDraft(current.activeId, 'Synthetic B input');
    await store.send(current.activeId, sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![1]).toEqual([]);
    expect(sender.mock.calls[0]![3]?.expectedConversationModel).toEqual({
      providerId: 'synthetic',
      modelId: 'b',
    });
    selected = 'a';
    await store.synchronizeModel(true);
    expect(store.archive.getSnapshot().lines).toEqual([]);
    expect(store.toolSourceSessionId(store.getSnapshot().activeId)).not.toBe(
      old,
    );
    await store.archive.list();
    await store.archive.select(old);
    expect(
      store.archive.getSnapshot().lines.map(line => line.content),
    ).toContain('Synthetic older answer');
    await f.quarantine();
    store.archive.invalidate();
    await store.archive.list();
    await store.archive.select(old);
    expect(
      store.archive.getSnapshot().lines.map(line => line.content),
    ).not.toContain('Synthetic older answer');
    expect(
      store.archive.getSnapshot().lines.map(line => line.content),
    ).not.toContain('Synthetic older question');
    expect(
      (
        await f.database.execute(
          "SELECT COUNT(*) AS n FROM conversation_artifacts WHERE id='older'",
        )
      ).rows[0]?.n,
    ).toBe(1);
  } finally {
    store.dispose();
    f.close();
  }
});
