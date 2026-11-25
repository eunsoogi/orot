import type {
  LocalEmbeddingModelIdentity,
  LocalEmbeddingVectorStore,
  LocalEmbeddingWrite,
  PersistedLocalEmbedding,
} from '@orot/rag';
import type { SqlDatabase, SqlExecutor, SqlTransaction } from '@orot/storage';
import { ensureModelRow, verifyModelRow } from './ragEmbeddingModel';
import {
  decodeVector,
  encodeVector,
  validateVector,
} from './ragEmbeddingVector';
import {
  assertRagEvidenceNotRemoved,
  clearRagEvidence,
  deleteRagEvidence,
  ensureRagEmbeddingDeletionSchema,
  findRemovedRagEvidence,
  upsertRagEmbeddingSources,
} from './ragEmbeddingDeletionStorage';
import {
  deletedSymptomIds,
  readSelectedSymptomQuarantine,
} from './agentMemorySymptomQuarantine';

import {
  createEmbeddingSchemaIfAbsent,
  embeddingSchema,
  EMBEDDINGS_TABLE,
  hasExactEmbeddingSchema,
} from './ragEmbeddingSchemaShape';

function cancelled(): Error {
  const error = new Error('Embedding storage was cancelled.');
  error.name = 'AbortError';
  return error;
}

// Stores model-keyed vectors in the already-open SQLCipher database without editing shared migrations.
export class SqlCipherRagEmbeddingStorage implements LocalEmbeddingVectorStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly database: SqlDatabase) {}

  /** Bind schema proof and legacy setup to the caller's exact transaction. */
  static async forCallerTransaction(
    transaction: SqlTransaction,
  ): Promise<SqlCipherRagEmbeddingStorage> {
    // The adapter cannot enqueue global work behind the transaction it owns.
    const storage = new SqlCipherRagEmbeddingStorage({
      execute: (sql, values) => transaction.execute(sql, values),
      transaction: operation => operation(transaction),
    });
    if (await hasExactEmbeddingSchema(transaction))
      storage.schemaReady = Promise.resolve();
    return storage;
  }

  static forVectorRead(transaction: SqlTransaction) {
    return SqlCipherRagEmbeddingStorage.forCallerTransaction(transaction);
  }

  /** Prepares RAG tables before callers join vector cleanup to an open deletion transaction. */
  async prepare(): Promise<void> {
    await this.ensureSchema();
  }

  async findRemovedTypedEvidence(
    references: readonly { readonly kind: string; readonly id: string }[],
  ): Promise<readonly { readonly kind: string; readonly id: string }[]> {
    const symptomIds = () =>
      references
        .filter(reference => reference.kind === 'symptom_entry')
        .map(reference => reference.id);
    const selected = await readSelectedSymptomQuarantine(
      this.database,
      symptomIds(),
    );
    const deleted =
      selected.matches(symptomIds()) ??
      (await deletedSymptomIds(this.database));
    return references.filter(
      reference =>
        reference.kind === 'symptom_entry' && deleted.has(reference.id),
    );
  }

  async upsertBatch(
    model: LocalEmbeddingModelIdentity,
    entries: readonly LocalEmbeddingWrite[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (!entry.chunkId)
        throw new Error('Embedding rows need a chunk identifier.');
      if (
        entry.sourceRecordIds.length === 0 ||
        entry.sourceRecordIds.some(sourceRecordId => !sourceRecordId.trim())
      ) {
        throw new Error('Embedding rows need source identifiers.');
      }
      validateVector(model, entry.vector);
    }
    await this.ensureSchema();
    if (signal?.aborted) throw cancelled();

    await this.database.transaction(async transaction => {
      await assertRagEvidenceNotRemoved(transaction, entries);
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
        await upsertRagEmbeddingSources(
          transaction,
          entry.chunkId,
          entry.sourceRecordIds,
        );
      }
    });
  }

  async deleteEvidence(
    sourceRecordIds: readonly string[],
    chunkIds: readonly string[],
    transaction?: SqlExecutor,
  ): Promise<void> {
    if (sourceRecordIds.length === 0 && chunkIds.length === 0) return;
    await this.ensureSchema();
    if (transaction) {
      await deleteRagEvidence(transaction, sourceRecordIds, chunkIds);
      return;
    }
    await this.database.transaction(async deletionTransaction => {
      await deleteRagEvidence(deletionTransaction, sourceRecordIds, chunkIds);
    });
  }

  async clear(
    sourceRecordIds: readonly string[] = [],
    transaction?: SqlExecutor,
  ): Promise<void> {
    await this.ensureSchema();
    if (transaction) {
      await clearRagEvidence(transaction, sourceRecordIds);
      return;
    }
    await this.database.transaction(async deletionTransaction => {
      await clearRagEvidence(deletionTransaction, sourceRecordIds);
    });
  }

  async findRemovedEvidence(
    sourceRecordIds: readonly string[],
    chunkIds: readonly string[],
    rootSourceRecordIds: readonly string[],
    localRecordIds: readonly string[] = [],
  ): Promise<{
    sourceRecordIds: readonly string[];
    chunkIds: readonly string[];
  }> {
    await this.ensureSchema();
    return findRemovedRagEvidence(
      this.database,
      sourceRecordIds,
      chunkIds,
      rootSourceRecordIds,
      localRecordIds,
    );
  }

  async listForModel(
    model: LocalEmbeddingModelIdentity,
    chunkIds?: readonly string[],
  ): Promise<readonly PersistedLocalEmbedding[]> {
    if (chunkIds?.length === 0) return [];
    await this.ensureSchema();
    // Revision keys alone are insufficient when cached vectors must match the exact model and tokenizer files.
    if (!(await verifyModelRow(this.database, model))) return [];
    // Candidate searches must not deserialize unrelated vectors. Bound parameter
    // batches also keep a larger caller-owned page below SQLite's variable limit.
    const ids = chunkIds ? [...new Set(chunkIds)] : undefined;
    const rows = [] as Awaited<ReturnType<SqlDatabase['execute']>>['rows'];
    for (let offset = 0; offset < (ids?.length ?? 1); offset += 100) {
      const batch = ids?.slice(offset, offset + 100);
      const result = await this.database.execute(
        `SELECT chunk_id, dimension, vector_blob FROM ${EMBEDDINGS_TABLE} WHERE model_id = ? AND model_revision = ? AND dimension = ?` +
          (batch
            ? ` AND chunk_id IN (${batch.map(() => '?').join(', ')})`
            : '') +
          ' ORDER BY chunk_id',
        [model.id, model.revision, model.dimension, ...(batch ?? [])],
      );
      rows.push(...result.rows);
    }
    return rows.map(row => {
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
        .execute(createEmbeddingSchemaIfAbsent(embeddingSchema.models))
        .then(async () => {
          await this.database.execute(
            createEmbeddingSchemaIfAbsent(embeddingSchema.vectors),
          );
          await this.database.transaction(async transaction => {
            await transaction.execute(
              createEmbeddingSchemaIfAbsent(embeddingSchema.modelIndex),
            );
            await ensureRagEmbeddingDeletionSchema(transaction);
          });
        })
        .catch(error => {
          this.schemaReady = null;
          throw error;
        });
    }
    await this.schemaReady;
  }
}
