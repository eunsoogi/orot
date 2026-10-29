import { createDatabase } from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { agentMemoryDatabaseFacade } from '../agentMemoryDatabaseFacade';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';

test('connection-specific facades expose only SQL operations and never redirect an old connection', async () => {
  const first = createDatabase();
  const second = createDatabase();
  let firstClosed = false;
  try {
    const oldFacade = agentMemoryDatabaseFacade(first);
    const newFacade = agentMemoryDatabaseFacade(second);
    expect(agentMemoryDatabaseFacade(first)).toBe(oldFacade);
    expect(newFacade).not.toBe(oldFacade);
    expect(Object.keys(oldFacade).sort()).toEqual(['execute', 'transaction']);
    for (const [facade, value] of [
      [oldFacade, 1],
      [newFacade, 2],
    ] as const) {
      await facade.execute('CREATE TABLE connection_receipt (value INTEGER)');
      await facade.execute('INSERT INTO connection_receipt VALUES (?)', [
        value,
      ]);
    }
    expect(
      (await oldFacade.execute('SELECT value FROM connection_receipt')).rows,
    ).toEqual([{ value: 1 }]);
    expect(
      (await newFacade.execute('SELECT value FROM connection_receipt')).rows,
    ).toEqual([{ value: 2 }]);
    // These are isolated test connections, not a new public app close/reopen API.
    await first.closeAsync?.();
    firstClosed = true;
    await expect(
      oldFacade.execute('SELECT value FROM connection_receipt'),
    ).rejects.toThrow();
    expect(
      (await newFacade.execute('SELECT value FROM connection_receipt')).rows,
    ).toEqual([{ value: 2 }]);
  } finally {
    if (!firstClosed) await first.closeAsync?.();
    await second.closeAsync?.();
  }
});

test('the facade preserves real transaction commit, original errors and rollback', async () => {
  const database = createDatabase();
  const facade = agentMemoryDatabaseFacade(database);
  const failure = new Error('transaction callback failed');
  try {
    await facade.execute('CREATE TABLE transaction_receipt (value INTEGER)');
    await facade.transaction(async tx => {
      await tx.execute('INSERT INTO transaction_receipt VALUES (1)');
    });
    await expect(
      facade.transaction(async tx => {
        await tx.execute('INSERT INTO transaction_receipt VALUES (2)');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      (await facade.execute('SELECT value FROM transaction_receipt')).rows,
    ).toEqual([{ value: 1 }]);
  } finally {
    await database.closeAsync?.();
  }
});

test.each(['table', 'index', 'transaction'] as const)(
  'schema preparation rejects every waiter after a %s failure and retries on the same facade',
  async phase => {
    const database = createDatabase();
    const facade = agentMemoryDatabaseFacade(database);
    const storage = new SqlCipherRagEmbeddingStorage(facade);
    const failure = new Error(`synthetic ${phase} preparation failure`);
    let shouldFail = true;
    const execute = database.execute.bind(database);
    const transaction = database.transaction.bind(database);
    const sql = jest
      .spyOn(database, 'execute')
      .mockImplementation(async (query, parameters) => {
        if (
          phase === 'table' &&
          shouldFail &&
          query.startsWith('CREATE TABLE')
        ) {
          shouldFail = false;
          throw failure;
        }
        return execute(query, parameters);
      });
    const tx = jest
      .spyOn(database, 'transaction')
      .mockImplementation(operation =>
        transaction(async executor => {
          await operation({
            ...executor,
            execute: async (query, parameters) => {
              if (
                phase === 'index' &&
                shouldFail &&
                query.startsWith('CREATE INDEX')
              ) {
                shouldFail = false;
                throw failure;
              }
              return executor.execute(query, parameters);
            },
          });
          if (phase === 'transaction' && shouldFail) {
            shouldFail = false;
            throw failure;
          }
        }),
      );
    try {
      // Both callers join the actual schemaReady promise; no mock successful cache masks a failure.
      const outcomes = await Promise.allSettled([
        storage.prepare(),
        storage.prepare(),
      ]);
      expect(outcomes).toEqual([
        { status: 'rejected', reason: failure },
        { status: 'rejected', reason: failure },
      ]);
      expect(agentMemoryDatabaseFacade(database)).toBe(facade);
      await storage.prepare();
      expect(
        (
          await facade.execute(
            "SELECT name FROM sqlite_master WHERE name = 'rag_embedding_sources_source_idx'",
          )
        ).rows,
      ).toEqual([{ name: 'rag_embedding_sources_source_idx' }]);
      sql.mockClear();
      tx.mockClear();
      await storage.prepare();
      expect(sql).not.toHaveBeenCalled();
      expect(tx).not.toHaveBeenCalled();
    } finally {
      sql.mockRestore();
      tx.mockRestore();
      await database.closeAsync?.();
    }
  },
);
