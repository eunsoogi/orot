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
import { createLocalE5RagService } from '../src/rag/localE5RagService';
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../src/rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));
async function fixture() {
  const f = openSqliteTestDatabase(':memory:');
  let owned = false;
  // Real SQLite serializes global operations. Fail fast at the same self-wait boundary
  // instead of leaving an intentionally deadlocked transaction hanging in the runner.
  const database: SqlDatabase = {
    execute: (query, args) => {
      if (owned)
        throw new Error('Global SQL queued behind its own transaction');
      return f.database.execute(query, args);
    },
    transaction: operation =>
      f.database.transaction(async tx => {
        owned = true;
        try {
          await operation(tx);
        } finally {
          owned = false;
        }
      }),
  };
  await runMigrations(database);
  const history = createManualHistoryRepository(database);
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
  const prepare = jest.fn(() => vectors.prepare());
  const deleteChunks = jest.fn((_chunks, ids, tx) =>
    vectors.deleteEvidence(ids, [], tx),
  );
  jest
    .mocked(openLocalStorage)
    .mockResolvedValue({ manualHistory: history } as never);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  jest
    .mocked(createLocalE5RagService)
    .mockReturnValue({ prepare, deleteChunks } as never);
  return {
    ...f,
    database,
    history,
    original,
    corrected,
    prepare,
    deleteChunks,
    repository: await openLocalManualHistoryRepository(),
  };
}
test('cold RAG schema prepares outside deletion while lineage and tombstones commit together', async () => {
  const f = await fixture();
  try {
    await expect(f.repository.delete(f.corrected.id)).resolves.toBe(true);
    expect(await f.history.list()).toEqual([]);
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
    f.prepare.mockRejectedValueOnce(new Error('Synthetic schema failure'));
    await expect(f.repository.delete(f.corrected.id)).rejects.toThrow(
      'Synthetic schema failure',
    );
    expect(await f.history.history(f.corrected.id)).toHaveLength(2);
    expect(f.deleteChunks).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
test('vector cleanup failure rolls back source deletion', async () => {
  const f = await fixture();
  try {
    f.deleteChunks.mockRejectedValueOnce(new Error('Synthetic vector failure'));
    await expect(f.repository.delete(f.corrected.id)).rejects.toThrow(
      'Synthetic vector failure',
    );
    expect(await f.history.history(f.corrected.id)).toHaveLength(2);
  } finally {
    f.close();
  }
});
