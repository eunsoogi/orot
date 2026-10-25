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

describe('legacy SQLCipher RAG embedding migration', () => {
  let database: SqlDatabase;
  let close: () => void = () => undefined;

  beforeEach(() => {
    const opened = openSqliteTestDatabase(':memory:');
    database = opened.database;
    close = opened.close;
  });

  afterEach(() => close());

  it('evicts unmapped cache without fencing a live source from reindexing', async () => {
    await database.execute(`
      CREATE TABLE rag_embedding_models (
        model_id TEXT NOT NULL, model_revision TEXT NOT NULL, dimension INTEGER NOT NULL,
        model_sha256 TEXT NOT NULL, tokenizer_sha256 TEXT NOT NULL,
        PRIMARY KEY (model_id, model_revision)
      )
    `);
    await database.execute(`
      CREATE TABLE rag_embeddings (
        chunk_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL,
        dimension INTEGER NOT NULL, vector_blob BLOB NOT NULL,
        PRIMARY KEY (chunk_id, model_id, model_revision)
      )
    `);
    await database.execute(`
      CREATE TABLE source_records (
        id TEXT PRIMARY KEY NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL, payload_json TEXT NOT NULL
      )
    `);
    await database.execute(
      'INSERT INTO rag_embedding_models (model_id, model_revision, dimension, model_sha256, tokenizer_sha256) VALUES (?, ?, ?, ?, ?)',
      [
        LOCAL_EMBEDDING_IDENTITY.id,
        LOCAL_EMBEDDING_IDENTITY.revision,
        LOCAL_EMBEDDING_IDENTITY.dimension,
        LOCAL_EMBEDDING_IDENTITY.modelSha256,
        LOCAL_EMBEDDING_IDENTITY.tokenizerSha256,
      ],
    );
    await database.execute(
      'INSERT INTO rag_embeddings (chunk_id, model_id, model_revision, dimension, vector_blob) VALUES (?, ?, ?, ?, ?)',
      [
        'legacy-chunk',
        LOCAL_EMBEDDING_IDENTITY.id,
        LOCAL_EMBEDDING_IDENTITY.revision,
        LOCAL_EMBEDDING_IDENTITY.dimension,
        new Uint8Array(
          LOCAL_EMBEDDING_IDENTITY.dimension * Float32Array.BYTES_PER_ELEMENT,
        ),
      ],
    );
    await database.execute(
      'INSERT INTO source_records (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        'legacy-source',
        '2026-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
        JSON.stringify({ id: 'legacy-source' }),
      ],
    );
    const storage = new SqlCipherRagEmbeddingStorage(database);

    await expect(
      storage.listForModel(LOCAL_EMBEDDING_IDENTITY),
    ).resolves.toEqual([]);
    const vectors = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embeddings',
    );
    const models = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embedding_models',
    );
    const tombstones = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embedding_removed_chunks WHERE chunk_id = ?',
      ['legacy-chunk'],
    );
    expect(vectors.rows[0]?.row_count).toBe(0);
    expect(models.rows[0]?.row_count).toBe(0);
    expect(tombstones.rows[0]?.row_count).toBe(0);
    await expect(
      storage.findRemovedEvidence(
        ['legacy-source'],
        ['legacy-chunk'],
        ['legacy-source'],
      ),
    ).resolves.toEqual({ sourceRecordIds: [], chunkIds: [] });
    await expect(
      storage.findRemovedEvidence(
        ['deleted-before-migration'],
        ['orphan-chunk'],
        ['deleted-before-migration'],
      ),
    ).resolves.toEqual({
      sourceRecordIds: ['deleted-before-migration'],
      chunkIds: [],
    });
    await expect(
      storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
        {
          chunkId: 'legacy-chunk',
          vector: vector(1),
          sourceRecordIds: ['legacy-source'],
        },
      ]),
    ).resolves.toBeUndefined();
    await expect(
      storage.listForModel(LOCAL_EMBEDDING_IDENTITY),
    ).resolves.toMatchObject([{ chunkId: 'legacy-chunk' }]);
  });
});
