import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';

function vector(first: number): number[] {
  return Array.from(
    { length: LOCAL_EMBEDDING_IDENTITY.dimension },
    (_, index) => (index === 0 ? first : 0),
  );
}

describe('SQLCipher RAG embedding deletion', () => {
  let database: SqlDatabase;
  let close: () => void = () => undefined;

  beforeEach(async () => {
    const opened = openSqliteTestDatabase(':memory:');
    database = opened.database;
    close = opened.close;
    await database.execute(`
      CREATE TABLE source_records (
        id TEXT PRIMARY KEY NOT NULL,
        effective_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      )
    `);
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        'retained-source',
        '2026-01-01',
        '2026-01-01',
        '2026-01-01',
        '{"id":"retained-source"}',
      ],
    );
  });

  afterEach(() => close());

  it('removes vectors for every model and retains a fence after storage recreation', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      {
        chunkId: 'removed-chunk',
        vector: vector(1),
        sourceRecordIds: ['removed-source'],
      },
      {
        chunkId: 'removed-chunk-2',
        vector: vector(0.75),
        sourceRecordIds: ['removed-source'],
      },
      {
        chunkId: 'retained-chunk',
        vector: vector(0.5),
        sourceRecordIds: ['retained-source'],
      },
    ]);
    await storage.upsertBatch(
      { ...LOCAL_EMBEDDING_IDENTITY, id: 'second-model' },
      [
        {
          chunkId: 'removed-chunk',
          vector: vector(0.25),
          sourceRecordIds: ['removed-source'],
        },
      ],
    );

    await storage.deleteEvidence(['removed-source'], []);
    const reopenedStorage = new SqlCipherRagEmbeddingStorage(database);

    await expect(
      reopenedStorage.findRemovedEvidence(
        ['removed-source', 'retained-source'],
        ['removed-chunk', 'retained-chunk'],
        ['removed-source', 'retained-source'],
      ),
    ).resolves.toEqual({
      sourceRecordIds: ['removed-source'],
      chunkIds: ['removed-chunk'],
    });
    expect(
      await reopenedStorage.listForModel(LOCAL_EMBEDDING_IDENTITY),
    ).toEqual([{ chunkId: 'retained-chunk', vector: vector(0.5) }]);
    await expect(
      reopenedStorage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'removed-chunk',
          vector: vector(1),
          sourceRecordIds: ['removed-source'],
        },
      ]),
    ).rejects.toThrow('Removed evidence cannot be indexed again.');
    await expect(
      reopenedStorage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'rebuilt-chunk',
          vector: vector(1),
          sourceRecordIds: ['removed-source'],
        },
      ]),
    ).rejects.toThrow('Removed evidence cannot be indexed again.');
    await expect(
      reopenedStorage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'new-retained-chunk',
          vector: vector(1),
          sourceRecordIds: ['retained-source'],
        },
      ]),
    ).resolves.toBeUndefined();
    const removedCount = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embeddings WHERE chunk_id = ?',
      ['removed-chunk'],
    );
    expect(removedCount.rows[0]?.row_count).toBe(0);
  });

  it('checks missing root sources without treating transcript revisions as source rows', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);

    await expect(
      storage.findRemovedEvidence(
        ['retained-source', 'transcript-revision-2'],
        ['corrected-transcript-chunk'],
        ['retained-source'],
      ),
    ).resolves.toEqual({ sourceRecordIds: [], chunkIds: [] });
    await expect(
      storage.findRemovedEvidence(
        ['deleted-root', 'transcript-revision-2'],
        ['deleted-root-chunk'],
        ['deleted-root'],
      ),
    ).resolves.toEqual({ sourceRecordIds: ['deleted-root'], chunkIds: [] });
  });

  it('clears vectors and fences mapped sources against new chunk IDs', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      {
        chunkId: 'old-chunk',
        vector: vector(1),
        sourceRecordIds: ['old-source'],
      },
    ]);

    // A full clear must discover source IDs from the persisted chunk map.
    await storage.clear();

    const rows = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embeddings',
    );
    const models = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embedding_models',
    );
    expect(rows.rows[0]?.row_count).toBe(0);
    expect(models.rows[0]?.row_count).toBe(0);
    await expect(
      storage.findRemovedEvidence(
        ['old-source'],
        ['old-chunk'],
        ['old-source'],
      ),
    ).resolves.toEqual({
      sourceRecordIds: ['old-source'],
      chunkIds: ['old-chunk'],
    });
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'old-chunk',
          vector: vector(1),
          sourceRecordIds: ['old-source'],
        },
      ]),
    ).rejects.toThrow('Removed evidence cannot be indexed again.');
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'new-old-source-chunk',
          vector: vector(1),
          sourceRecordIds: ['old-source'],
        },
      ]),
    ).rejects.toThrow('Removed evidence cannot be indexed again.');
  });
});
