import {
  createManualHistoryRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagEmbeddingStorage } from '../src/storage/ragEmbeddingStorage';
import { openLocalManualHistoryRepository } from '../src/manualHistory/localRepository';
import {
  openLocalStorage,
  openLocalAgentMemoryDatabase,
} from '../src/storage/secureDatabase';
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  let owned = false;
  const lineageReads = jest.fn();
  const sharedExecute = jest.fn();
  const sharedTransaction = jest.fn();
  const schemaWrites = jest.fn();
  let beforeAdmission: Promise<unknown> | undefined;
  let beforeCommit: Promise<unknown> | undefined;
  let failQuery: ((query: string) => void) | undefined;
  // Real SQLite serializes global operations. Fail fast at the same self-wait boundary
  // instead of leaving an intentionally deadlocked transaction hanging in the runner.
  const database: SqlDatabase = {
    execute: (query, args) => {
      if (owned)
        throw new Error('Global SQL queued behind its own transaction');
      sharedExecute();
      return f.database.execute(query, args);
    },
    transaction: async operation => {
      sharedTransaction();
      await beforeAdmission;
      return f.database.transaction(async tx => {
        owned = true;
        try {
          await operation({
            ...tx,
            execute: (query, args) => {
              if (
                query.startsWith('SELECT ') &&
                query.includes('FROM manual_history_entries WHERE')
              )
                lineageReads();
              if (query.startsWith('CREATE ')) schemaWrites();
              failQuery?.(query);
              return tx.execute(query, args);
            },
          });
          await beforeCommit;
        } finally {
          owned = false;
        }
      });
    },
  };
  await runMigrations(database);
  const ids = ['conversation-local-memory:original', 'correction', 'unrelated'];
  const history = createManualHistoryRepository(database, {
    createId: () => ids.shift()!,
  });
  const original = await history.create({
    kind: 'diagnosis_history',
    title: 'Synthetic original',
    details: 'Synthetic',
    effectiveDate: { status: 'unknown' },
  });
  const corrected = await history.correct(original.id, {
    kind: 'diagnosis_history',
    title: 'Synthetic correction',
    details: 'Synthetic',
    effectiveDate: { status: 'unknown' },
    correctionNote: 'Synthetic correction',
  });
  const vectors = new SqlCipherRagEmbeddingStorage(database);
  jest
    .mocked(openLocalStorage)
    .mockResolvedValue({ manualHistory: history } as never);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  return {
    ...f,
    database,
    history,
    original,
    corrected,
    lineageReads,
    vectors,
    sharedExecute,
    sharedTransaction,
    schemaWrites,
    holdAdmission: (gate: Promise<unknown>) => (beforeAdmission = gate),
    holdCommit: (gate: Promise<unknown>) => (beforeCommit = gate),
    failOn: (handler: (query: string) => void) => {
      failQuery = handler;
    },
    repository: await openLocalManualHistoryRepository(),
  };
}
test('cold cleanup admits one writer and commits the conversation memory lineage with its tombstones', async () => {
  const f = await fixture();
  try {
    const unrelated = await f.history.create({
      kind: 'note',
      title: 'Synthetic unrelated entry',
      details: 'Synthetic',
      effectiveDate: { status: 'unknown' },
    });
    f.lineageReads.mockClear();
    f.sharedExecute.mockClear();
    f.sharedTransaction.mockClear();
    await expect(f.repository.delete(f.corrected.id)).resolves.toBe(true);
    // The older path traversed both versions twice (eight point reads).
    expect(f.lineageReads).toHaveBeenCalledTimes(4);
    expect(f.sharedExecute).not.toHaveBeenCalled();
    expect(f.sharedTransaction).toHaveBeenCalledTimes(1);
    expect(await f.history.list()).toEqual([unrelated]);
    const rows = await f.database.execute(
      'SELECT source_record_id FROM rag_embedding_removed_sources ORDER BY source_record_id',
    );
    expect(rows.rows.map(row => row.source_record_id).sort()).toEqual(
      [f.original.id, f.corrected.id].sort(),
    );
    await expect(f.repository.delete(f.corrected.id)).resolves.toBe(false);
  } finally {
    f.close();
  }
});
test('schema failure leaves correction lineage intact', async () => {
  const f = await fixture();
  try {
    f.failOn(query => {
      if (query.startsWith('CREATE TABLE'))
        throw new Error('Synthetic schema failure');
    });
    await expect(f.repository.delete(f.corrected.id)).rejects.toThrow(
      'Synthetic schema failure',
    );
    expect(await f.history.history(f.corrected.id)).toHaveLength(2);
  } finally {
    f.close();
  }
});
test('vector cleanup failure rolls back source deletion', async () => {
  const f = await fixture();
  try {
    f.failOn(query => {
      if (
        query.startsWith('INSERT OR IGNORE INTO rag_embedding_removed_sources')
      )
        throw new Error('Synthetic vector failure');
    });
    await expect(f.repository.delete(f.corrected.id)).rejects.toThrow(
      'Synthetic vector failure',
    );
    expect(await f.history.history(f.corrected.id)).toHaveLength(2);
  } finally {
    f.close();
  }
});

test('warm cleanup avoids no-op schema writes and removes only the owned vector', async () => {
  const f = await fixture();
  try {
    const model = {
      id: 'synthetic',
      revision: 'one',
      dimension: 1,
      modelSha256: 'model',
      tokenizerSha256: 'tokenizer',
    };
    await f.vectors.upsertBatch(model, [
      {
        chunkId: 'owned-chunk',
        sourceRecordIds: [f.original.id],
        vector: [1],
      },
      {
        chunkId: 'unrelated-chunk',
        sourceRecordIds: ['synthetic-unrelated-source'],
        vector: [2],
      },
    ]);
    f.schemaWrites.mockClear();
    f.sharedExecute.mockClear();
    f.sharedTransaction.mockClear();
    await expect(f.repository.delete(f.corrected.id)).resolves.toBe(true);
    expect(f.schemaWrites).not.toHaveBeenCalled();
    expect(f.sharedExecute).not.toHaveBeenCalled();
    expect(f.sharedTransaction).toHaveBeenCalledTimes(1);
    expect(await f.vectors.listForModel(model)).toEqual([
      { chunkId: 'unrelated-chunk', vector: [2] },
    ]);
  } finally {
    f.close();
  }
});

function makeGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('traces protected admission, lineage and vectors separately from durable commit', async () => {
  const f = await fixture();
  const { promise: admission, resolve: admit } = makeGate();
  const { promise: commit, resolve: persist } = makeGate();
  const { promise: reachedCommit, resolve: reportCommit } = makeGate();
  const events: string[][] = [];
  const repository = await openLocalManualHistoryRepository(
    (stage, outcome) => {
      events.push([stage, outcome]);
      if (stage === 'saved_memory_delete_commit' && outcome === 'started')
        reportCommit();
    },
  );
  f.holdAdmission(admission);
  f.holdCommit(commit);
  const deleting = repository.delete(f.corrected.id);
  try {
    expect(events).toEqual([['saved_memory_delete_queue', 'started']]);
    admit();
    await reachedCommit;
    expect(events).toEqual([
      ['saved_memory_delete_queue', 'started'],
      ['saved_memory_delete_queue', 'completed'],
      ['saved_memory_delete_lineage', 'started'],
      ['saved_memory_delete_vectors', 'started'],
      ['saved_memory_delete_vectors', 'completed'],
      ['saved_memory_delete_lineage', 'completed'],
      ['saved_memory_delete_commit', 'started'],
    ]);
    persist();
    await expect(deleting).resolves.toBe(true);
    expect(events.at(-1)).toEqual(['saved_memory_delete_commit', 'completed']);
    expect(await f.history.list()).toEqual([]);
  } finally {
    admit();
    persist();
    await deleting.catch(() => undefined);
    f.close();
  }
});
