import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';

function vector(first: number): number[] {
  return Array.from(
    { length: LOCAL_EMBEDDING_IDENTITY.dimension },
    (_, index) => (index === 0 ? first : 0),
  );
}

describe('SQLCipher RAG embedding storage', () => {
  let database: SqlDatabase;
  let close: () => void = () => undefined;

  // Real SQLite proves schema and transaction behavior; Simulator coverage proves the SQLCipher connection path.
  beforeEach(() => {
    const opened = openSqliteTestDatabase(':memory:');
    database = opened.database;
    close = opened.close;
  });

  afterEach(() => close());

  it('persists model identity and round-trips little-endian float32 vectors', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);
    const embedding = vector(0.75);

    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      { chunkId: 'chunk-1', vector: embedding },
    ]);

    const models = await database.execute(
      'SELECT model_id, model_revision, dimension, model_sha256, tokenizer_sha256 FROM rag_embedding_models',
    );
    expect(models.rows).toEqual([
      {
        model_id: LOCAL_EMBEDDING_IDENTITY.id,
        model_revision: LOCAL_EMBEDDING_IDENTITY.revision,
        dimension: LOCAL_EMBEDDING_IDENTITY.dimension,
        model_sha256: LOCAL_EMBEDDING_IDENTITY.modelSha256,
        tokenizer_sha256: LOCAL_EMBEDDING_IDENTITY.tokenizerSha256,
      },
    ]);
    expect(await storage.listForModel(LOCAL_EMBEDDING_IDENTITY)).toEqual([
      { chunkId: 'chunk-1', vector: embedding },
    ]);
  });

  it('rejects a revision whose persisted model hashes differ from the requested identity', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);
    await storage.upsertBatch(LOCAL_EMBEDDING_IDENTITY, [
      { chunkId: 'chunk-1', vector: vector(1) },
    ]);

    await expect(
      storage.listForModel({
        ...LOCAL_EMBEDDING_IDENTITY,
        modelSha256: 'f'.repeat(64),
      }),
    ).rejects.toThrow(
      'A model revision cannot be reused with different embedding identity metadata.',
    );
  });

  it('rolls back the current persistence batch when cancellation arrives between rows', async () => {
    const controller = new AbortController();
    const databaseWithAbort: SqlDatabase = {
      execute: (query, parameters) => database.execute(query, parameters),
      transaction: operation =>
        database.transaction(transaction => {
          const cancellable: SqlTransaction = {
            ...transaction,
            execute: async (query, parameters) => {
              const result = await transaction.execute(query, parameters);
              if (query.includes('INSERT INTO rag_embeddings'))
                controller.abort();
              return result;
            },
          };
          return operation(cancellable);
        }),
    };
    const storage = new SqlCipherRagEmbeddingStorage(databaseWithAbort);

    await expect(
      storage.upsertBatch(
        LOCAL_EMBEDDING_IDENTITY,
        [
          { chunkId: 'chunk-1', vector: vector(1) },
          { chunkId: 'chunk-2', vector: vector(0.5) },
        ],
        controller.signal,
      ),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(await storage.listForModel(LOCAL_EMBEDDING_IDENTITY)).toEqual([]);
  });

  it('does not write rows after an aborted signal', async () => {
    const storage = new SqlCipherRagEmbeddingStorage(database);
    const controller = new AbortController();
    controller.abort();

    await expect(
      storage.upsertBatch(
        LOCAL_EMBEDDING_IDENTITY,
        [{ chunkId: 'chunk-1', vector: vector(1) }],
        controller.signal,
      ),
    ).rejects.toHaveProperty('name', 'AbortError');
    const models = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embedding_models',
    );
    const embeddings = await database.execute(
      'SELECT count(*) AS row_count FROM rag_embeddings',
    );
    expect(models.rows[0]?.row_count).toBe(0);
    expect(embeddings.rows[0]?.row_count).toBe(0);
  });
});
