import { quarantinedHistoryFixture as fixture } from '../testSupport/quarantinedHistoryFixture';
import { restoreConversationSessionTurns } from '../restoreConversationSessionTurns';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';

test('a quarantined older parent restores a metadata notice alongside a valid newer turn', async () => {
  const f = await fixture();
  try {
    const signal = new AbortController().signal;
    expect(
      (await f.discovery.readSession({ sessionId: 'session', signal })).items,
    ).toHaveLength(2);
    await f.quarantine();
    const page = await f.discovery.readSession({
      sessionId: 'session',
      signal,
    });
    expect(page.items.map(item => item.id)).toEqual(['newer']);
    expect(page.unavailableCount).toBe(1);
    const restored = await restoreConversationSessionTurns(
      f.input,
      f.open,
      'session',
      signal,
    );
    const history = await conversationHistoryPageOption(f.input, f.open)(
      'session',
      signal,
    );
    expect(restored.map(turn => turn.toolMessageId)).toEqual([
      'older',
      'newer',
    ]);
    expect(history.turns).toEqual([
      {
        ...restored[0],
        voiceTimelineOrder: {
          createdAt: '2026-10-05T00:00:00.000Z',
          id: 'older',
        },
      },
      {
        ...restored[1],
        voiceTimelineOrder: {
          createdAt: '2026-10-06T00:00:00.000Z',
          id: 'newer',
        },
      },
    ]);
    expect(restored[0]).toMatchObject({
      question: '',
      historyUnavailable: true,
      citations: [],
      healthSources: [],
      toolEvents: [],
    });
    expect(restored[1]?.answer).toBe('Synthetic safe answer');
    expect(JSON.stringify(restored)).not.toContain('Synthetic older');
    expect(JSON.stringify(restored)).not.toContain(f.saved.id);
    const isolated = await restoreConversationSessionTurns(
      f.input,
      f.open,
      'session',
      signal,
      {
        ids: ['newer'],
        version: (await f.storage.activeSessionVersion('session'))!,
      },
    );
    expect(isolated.map(turn => turn.toolMessageId)).toEqual(['newer']);
    expect(JSON.stringify(isolated)).not.toContain('Synthetic older answer');
    expect(await f.storage.read('newer')).not.toBeNull();
    expect(
      (await f.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('audit: stable summary quarantine metadata alone does not change timeline fingerprints', async () => {
  const f = await fixture();
  try {
    const signal = new AbortController().signal;
    const version = (await f.storage.activeSessionVersion('session'))!;
    const before = await f.storage.listTimeline('session', version);
    await f.quarantine();
    const after = await f.storage.listTimeline('session', version);
    expect(after).toEqual(before);
    expect(
      (await f.discovery.readSession({ sessionId: 'session', signal }))
        .unavailableCount,
    ).toBe(1);
  } finally {
    f.close();
  }
});

test('unavailable-only pages advance the original keyset cursor without exposing source content', async () => {
  const f = await fixture();
  try {
    await f.quarantine();
    const signal = new AbortController().signal;
    const first = await f.discovery.readSession({
      sessionId: 'session',
      signal,
      limit: 1,
    });
    expect(first.items.map(item => item.id)).toEqual(['newer']);
    expect(first.nextCursor).not.toBeNull();
    const last = await f.discovery.readSession({
      sessionId: 'session',
      signal,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(last.items).toEqual([]);
    expect(last.unavailableItems).toEqual([
      { id: 'older', createdAt: '2026-10-05T00:00:00.000Z' },
    ]);
    expect(last.nextCursor).toBeNull();
  } finally {
    f.close();
  }
});

test('operational source validation failures reject instead of becoming notices', async () => {
  const f = await fixture();
  try {
    const execute = f.database.transaction.bind(f.database);
    jest.spyOn(f.database, 'transaction').mockImplementation(async action =>
      execute(async tx => {
        const original = tx.execute.bind(tx);
        tx.execute = async (sql, parameters) => {
          if (sql.includes('FROM summary_period_policy'))
            throw new Error('synthetic database unavailable');
          return original(sql, parameters);
        };
        return action(tx);
      }),
    );
    await expect(f.storage.read('older')).rejects.toThrow(
      'synthetic database unavailable',
    );
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('deletion during page hydration still rejects rather than publishing a notice', async () => {
  const f = await fixture();
  try {
    const readMany = f.storage.readMany.bind(f.storage);
    jest.spyOn(f.storage, 'readMany').mockImplementationOnce(async ids => {
      await f.database.execute(
        'DELETE FROM conversation_artifacts WHERE id = ?',
        ['newer'],
      );
      return readMany(ids);
    });
    await expect(
      f.discovery.readSession({
        sessionId: 'session',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Conversation content changed during restoration.');
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('a session removed while restoring notices does not publish metadata', async () => {
  const f = await fixture();
  try {
    await f.quarantine();
    const readTools = f.storage.readToolTurnsSnapshot.bind(f.storage);
    jest
      .spyOn(f.storage, 'readToolTurnsSnapshot')
      .mockImplementationOnce(async (...args) => {
        await f.storage.deleteSession('session');
        return readTools(...args);
      });
    await expect(
      restoreConversationSessionTurns(
        f.input,
        f.open,
        'session',
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
