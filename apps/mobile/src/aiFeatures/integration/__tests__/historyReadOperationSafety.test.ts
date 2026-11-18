import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';

// Real SQLite mutation occurs after the first strict lease fence, not before scope creation.
test.each(['quarantine', 'delete', 'hide', 'abort'] as const)(
  'full history still refuses %s between its two strict fences',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const transaction = f.database.transaction.bind(f.database);
    const controller = new AbortController();
    let changed = false;
    f.database.transaction = async work => {
      let lease = false;
      let artifact = false;
      await transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          if (
            args[0].startsWith(
              'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation',
            )
          )
            lease = true;
          if (
            args[0].startsWith(
              'SELECT a.id, a.session_id, a.created_at, a.result_json',
            )
          )
            artifact = true;
          return execute(...args);
        };
        await work(tx);
      });
      if (lease && artifact && !changed) {
        changed = true;
        if (mode === 'quarantine') await f.quarantine();
        if (mode === 'delete')
          await f.repository.delete('health_observation', f.inside.id);
        if (mode === 'hide')
          await f.database.execute(
            "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
          );
        if (mode === 'abort') controller.abort();
      }
    };
    try {
      await expect(
        conversationHistoryPageOption(f.input, f.open)(
          'session',
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      if (mode === 'quarantine')
        expect(
          (
            await f.database.execute(
              'SELECT id FROM symptom_summary_runs WHERE id=?',
              [f.saved.id],
            )
          ).rows,
        ).toHaveLength(1);
    } finally {
      f.database.transaction = transaction;
      f.close();
    }
  },
);

test('custom discovery and escaped or replaced methods do not retain operation authority', async () => {
  const f = await quarantinedHistoryFixture();
  const signal = new AbortController().signal;
  try {
    const custom = { ...f.discovery };
    await withConversationHistoryReadOperation(custom, signal, async scoped => {
      expect(scoped).toBe(custom);
    });
    let escaped!: typeof f.discovery;
    await withConversationHistoryReadOperation(
      f.discovery,
      signal,
      async scoped => {
        escaped = scoped;
        expect(scoped).not.toBe(f.discovery);
        await scoped.readSession({ sessionId: 'session', signal });
      },
    );
    await f.quarantine();
    const page = await escaped.readSession({ sessionId: 'session', signal });
    expect(page.items.map(item => item.id)).toEqual(['newer']);
    const original = f.discovery.revalidateSession;
    const replacement = jest.fn(original);
    await withConversationHistoryReadOperation(
      f.discovery,
      signal,
      async scoped => {
        f.discovery.revalidateSession = replacement;
        expect(
          await scoped.revalidateSession(
            'session',
            (await f.discovery.activeSessionVersion('session'))!,
            [],
            signal,
          ),
        ).toBe(true);
        expect(replacement).toHaveBeenCalledTimes(1);
      },
    );
  } finally {
    f.close();
  }
});

/** Tool snapshot capability never upgrades a foreign owner or survives the history call. */
test('history tool snapshots preserve foreign, replaced and escaped owner boundaries', async () => {
  const f = await quarantinedHistoryFixture();
  const signal = new AbortController().signal;
  const original = f.storage.readToolTurnsSnapshot;
  let escaped!: typeof f.storage;
  try {
    await withConversationHistoryReadOperation(
      f.discovery,
      signal,
      async (_, context) => {
        expect(context).toBeDefined();
        const foreign = { ...f.storage };
        expect(context!.storage(foreign)).toBe(foreign);
        escaped = context!.storage(f.storage);
        expect(escaped).not.toBe(f.storage);
        await escaped.readToolTurnsSnapshot('session');
        const replaced = jest.fn(original);
        f.storage.readToolTurnsSnapshot = replaced;
        await escaped.readToolTurnsSnapshot('session');
        expect(replaced).toHaveBeenCalledTimes(1);
        f.storage.readToolTurnsSnapshot = original;
      },
    );
    const afterDispose = jest.fn(original);
    f.storage.readToolTurnsSnapshot = afterDispose;
    await escaped.readToolTurnsSnapshot('session');
    expect(afterDispose).toHaveBeenCalledTimes(1);
  } finally {
    f.storage.readToolTurnsSnapshot = original;
    f.close();
  }
});
