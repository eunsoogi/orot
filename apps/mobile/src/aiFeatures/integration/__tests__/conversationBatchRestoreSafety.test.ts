import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

const signal = () => new AbortController().signal;

test('live aliases reopen the original strict storage after batch snapshots have gone out of scope', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const page = await f.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    const item = page.items.find(value => value.id === 'older')!;
    const read = jest.spyOn(f.storage, 'read');
    await f.database.execute(
      "DELETE FROM conversation_artifacts WHERE id='older'",
    );
    const result = await f.input.registry.readSource(
      item.sources[0]!,
      signal(),
    );
    expect(result.status).toBe('missing');
    expect(read).toHaveBeenCalledWith('older');
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('same IDs in another database do not lend validity to an unavailable batch or its live aliases', async () => {
  const a = await quarantinedHistoryFixture();
  const b = await quarantinedHistoryFixture();
  try {
    const first = await a.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    const alias = first.items.find(item => item.id === 'older')!.sources[0]!;
    await a.quarantine();
    const independent = await b.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    expect(independent.items.some(item => item.id === 'older')).toBe(true);
    expect(
      (await a.input.registry.readSource(alias, signal())).status,
    ).not.toBe('available');
    const withheld = await a.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    expect(withheld.items.map(item => item.id)).toEqual(['newer']);
  } finally {
    a.close();
    b.close();
  }
});

test('a rollback and operational error cannot publish a reusable snapshot on a later read', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const transaction = f.database.transaction.bind(f.database);
    let failed = false;
    const intercept = jest
      .spyOn(f.database, 'transaction')
      .mockImplementation(operation =>
        transaction(async tx => {
          let readRoot = false;
          const execute = tx.execute.bind(tx);
          tx.execute = async (query, bindings) => {
            if (
              query.includes(
                'SELECT a.id, a.session_id, a.created_at, a.result_json',
              )
            )
              readRoot = true;
            return execute(query, bindings);
          };
          await operation(tx);
          if (readRoot && !failed) {
            failed = true;
            throw new Error('Synthetic rollback');
          }
        }),
      );
    await expect(
      f.discovery.readSession({ sessionId: 'session', signal: signal() }),
    ).rejects.toThrow('Synthetic rollback');
    intercept.mockRestore();
    await f.quarantine();
    const retry = await f.discovery.readSession({
      sessionId: 'session',
      signal: signal(),
    });
    expect(retry.items.map(item => item.id)).toEqual(['newer']);
    expect(retry.unavailableCount).toBe(1);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('cancellation during source hydration returns no batch result', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const controller = new AbortController();
    const data = await f.input.loadLocalData();
    const discovery = data.summaryArtifactDiscovery!;
    data.summaryArtifactDiscovery = async registry => {
      const current = await discovery(registry);
      return {
        ...current,
        read: async (...args) => {
          const result = await current.read(...args);
          controller.abort();
          return result;
        },
      };
    };
    await expect(
      f.discovery.readSession({
        sessionId: 'session',
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
  } finally {
    f.close();
  }
});

test('a changed root between the initial and final batches rejects the hydrated page', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const readMany = f.storage.readMany.bind(f.storage);
    let batches = 0;
    jest.spyOn(f.storage, 'readMany').mockImplementation(async ids => {
      batches += 1;
      if (batches === 2) {
        await f.database.execute(
          "UPDATE conversation_artifacts SET result_json=json_set(result_json, '$.answer', 'Synthetic changed') WHERE id='older'",
        );
      }
      return readMany(ids);
    });
    await expect(
      f.discovery.readSession({ sessionId: 'session', signal: signal() }),
    ).rejects.toThrow('Conversation content changed during restoration.');
    expect(batches).toBe(2);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
