import type {
  LocalEmbeddingModelIdentity,
  LocalEmbeddingVectorStore,
  PersistedLocalEmbedding,
} from '@orot/rag';
import type { SqlDatabase, SqlExecutor, SqlValue } from '@orot/storage';

const EMBEDDING_MODELS_TABLE = 'rag_embedding_models';
const EMBEDDINGS_TABLE = 'rag_embeddings';

function cancelled(): Error {
  const error = new Error('Embedding storage was cancelled.');
  error.name = 'AbortError';
  return error;
}

function validateVector(
  model: LocalEmbeddingModelIdentity,
  vector: readonly number[],
): void {
  if (
    vector.length !== model.dimension ||
    vector.some(value => !Number.isFinite(value))
  ) {
    throw new Error(
      'Embedding vector does not match the stored model dimension.',
    );
  }
}

function encodeVector(vector: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  vector.forEach((value, index) => {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true);
  });
  return bytes;
}

function decodeBytes(value: SqlValue | undefined): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('The encrypted embedding row has no binary vector.');
}

function decodeVector(
  value: SqlValue | undefined,
  dimension: number,
): number[] {
  const bytes = decodeBytes(value);
  if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(
      'The encrypted embedding row has an invalid vector length.',
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: dimension }, (_, index) =>
    view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true),
  );
}

async function verifyModelRow(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
): Promise<boolean> {
  const result = await executor.execute(
    `SELECT dimension, model_sha256, tokenizer_sha256 FROM ${EMBEDDING_MODELS_TABLE} WHERE model_id = ? AND model_revision = ?`,
    [model.id, model.revision],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (
    row.dimension !== model.dimension ||
    row.model_sha256 !== model.modelSha256 ||
    row.tokenizer_sha256 !== model.tokenizerSha256
  ) {
    throw new Error(
      'A model revision cannot be reused with different embedding identity metadata.',
    );
  }
  return true;
}

async function ensureModelRow(
  executor: SqlExecutor,
  model: LocalEmbeddingModelIdentity,
): Promise<void> {
  await executor.execute(
    `INSERT INTO ${EMBEDDING_MODELS_TABLE} (model_id, model_revision, dimension, model_sha256, tokenizer_sha256) VALUES (?, ?, ?, ?, ?) ON CONFLICT(model_id, model_revision) DO NOTHING`,
    [
      model.id,
      model.revision,
      model.dimension,
      model.modelSha256,
      model.tokenizerSha256,
    ],
  );
  if (!(await verifyModelRow(executor, model))) {
    throw new Error('The embedding model identity row could not be persisted.');
  }
}

// Stores model-keyed vectors in the already-open SQLCipher database without editing shared migrations.
export class SqlCipherRagEmbeddingStorage implements LocalEmbeddingVectorStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly database: SqlDatabase) {}

  async upsertBatch(
    model: LocalEmbeddingModelIdentity,
    entries: readonly PersistedLocalEmbedding[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (!entry.chunkId)
        throw new Error('Embedding rows need a chunk identifier.');
      validateVector(model, entry.vector);
    }
    await this.ensureSchema();
    if (signal?.aborted) throw cancelled();

    await this.database.transaction(async transaction => {
      await ensureModelRow(transaction, model);
      for (const entry of entries) {
        if (signal?.aborted) throw cancelled();
        await transaction.execute(
          `INSERT INTO ${EMBEDDINGS_TABLE} (chunk_id, model_id, model_revision, dimension, vector_blob) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chunk_id, model_id, model_revision) DO UPDATE SET dimension = excluded.dimension, vector_blob = excluded.vector_blob`,
          [
            entry.chunkId,
            model.id,
            model.revision,
            model.dimension,
            encodeVector(entry.vector),
          ],
        );
      }
    });
  }

  async listForModel(
    model: LocalEmbeddingModelIdentity,
  ): Promise<readonly PersistedLocalEmbedding[]> {
    await this.ensureSchema();
    // Revision keys alone are insufficient when cached vectors must match the exact model and tokenizer files.
    if (!(await verifyModelRow(this.database, model))) return [];
    const result = await this.database.execute(
      `SELECT chunk_id, dimension, vector_blob FROM ${EMBEDDINGS_TABLE} WHERE model_id = ? AND model_revision = ? AND dimension = ? ORDER BY chunk_id`,
      [model.id, model.revision, model.dimension],
    );
    return result.rows.map(row => {
      if (
        row.dimension !== model.dimension ||
        typeof row.chunk_id !== 'string'
      ) {
        throw new Error(
          'The encrypted embedding row has invalid model metadata.',
        );
      }
      return {
        chunkId: row.chunk_id,
        vector: decodeVector(row.vector_blob, model.dimension),
      };
    });
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.database
        .execute(
          `CREATE TABLE IF NOT EXISTS ${EMBEDDING_MODELS_TABLE} (model_id TEXT NOT NULL, model_revision TEXT NOT NULL, dimension INTEGER NOT NULL, model_sha256 TEXT NOT NULL, tokenizer_sha256 TEXT NOT NULL, PRIMARY KEY (model_id, model_revision))`,
        )
        .then(async () => {
          await this.database.execute(
            `CREATE TABLE IF NOT EXISTS ${EMBEDDINGS_TABLE} (chunk_id TEXT NOT NULL, model_id TEXT NOT NULL, model_revision TEXT NOT NULL, dimension INTEGER NOT NULL, vector_blob BLOB NOT NULL, PRIMARY KEY (chunk_id, model_id, model_revision))`,
          );
          await this.database.execute(
            `CREATE INDEX IF NOT EXISTS rag_embeddings_model_idx ON ${EMBEDDINGS_TABLE} (model_id, model_revision, dimension)`,
          );
        })
        .catch(error => {
          this.schemaReady = null;
          throw error;
        });
    }
    await this.schemaReady;
  }
}
