import type { EvidenceChunk, LocalEmbeddingModelIdentity } from '@orot/rag';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { assertRagEvidenceNotRemoved } from './ragEmbeddingDeletionStorage';
import { SqlCipherRagEmbeddingStorage } from './ragEmbeddingStorage';
import {
  eligibleVectorChunks,
  evidenceIdentities,
  evidenceReferences,
} from './ragVectorStoreEvidence';
import {
  readVectorRevisions,
  vectorDocumentFingerprint,
} from './ragVectorStoreRevision';

const proofWindowSize = 32;
const digestBatch = 4;

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('Local embedding was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

/** Old upsert also repairs reverse source edges; a warm hit must not skip that repair. */
async function exactSourceMaps(
  executor: SqlExecutor,
  candidates: readonly EvidenceChunk[],
) {
  const expected = new Map(
    candidates.map(chunk => [chunk.id, new Set(evidenceIdentities(chunk))]),
  );
  const actual = new Map<string, Set<string>>();
  const result = await executor.execute(
    'SELECT chunk_id, source_record_id FROM rag_embedding_sources WHERE chunk_id IN (SELECT value FROM json_each(?))',
    [JSON.stringify([...expected.keys()])],
  );
  for (const row of result.rows) {
    if (
      typeof row.chunk_id !== 'string' ||
      typeof row.source_record_id !== 'string'
    ) {
      throw new Error('Vector reverse source mapping is unavailable.');
    }
    const reached = actual.get(row.chunk_id) ?? new Set<string>();
    reached.add(row.source_record_id);
    actual.set(row.chunk_id, reached);
  }
  return candidates.filter(({ id }) => {
    const wanted = expected.get(id)!;
    const mapped = actual.get(id);
    return (
      mapped?.size === wanted.size &&
      [...wanted].every(value => mapped.has(value))
    );
  });
}

async function read(
  database: SqlDatabase,
  model: LocalEmbeddingModelIdentity,
  page: readonly EvidenceChunk[],
  signal?: AbortSignal,
) {
  let snapshot!: {
    candidates: readonly EvidenceChunk[];
    vectors: ReadonlyMap<string, readonly number[]>;
    revisions: ReadonlyMap<string, string>;
  };
  await database.transaction(async transaction => {
    checkAbort(signal);
    const storage = new SqlCipherRagEmbeddingStorage({
      execute: (sql, values) => transaction.execute(sql, values),
      transaction: operation => operation(transaction),
    });
    const revisions = await readVectorRevisions(
      transaction,
      model,
      page.map(chunk => chunk.id),
    );
    if (!revisions.size) {
      snapshot = { candidates: [], vectors: new Map(), revisions };
      return;
    }
    const candidates = await eligibleVectorChunks(
      page.filter(chunk => revisions.has(chunk.id)),
      storage,
    );
    const ids = candidates.map(chunk => chunk.id);
    const vectors = new Map(
      (
        await storage.listForModel(
          model,
          ids.filter(id => revisions.has(id)),
        )
      ).map(row => [row.chunkId, row.vector]),
    );
    const indexed = candidates.filter(chunk => vectors.has(chunk.id));
    const reusable = indexed.length
      ? await exactSourceMaps(transaction, indexed)
      : [];
    if (reusable.length) {
      // This is the same typed/untyped alias admission as the writer performs.
      // Keep it inside each owning read, including the post-hash read.
      await assertRagEvidenceNotRemoved(
        transaction,
        reusable.map(chunk => ({
          chunkId: chunk.id,
          vector: vectors.get(chunk.id)!,
          sourceRecordIds: evidenceIdentities(chunk),
          sourceReferences: evidenceReferences(chunk),
        })),
      );
    }
    checkAbort(signal);
    snapshot = { candidates: reusable, vectors, revisions };
  });
  return snapshot;
}

/** Warm-query optimization only; the ordinary candidate search still rechecks
 * exact evidence, model and removals. Legacy/missing vectors never qualify. */
export async function findVerifiedRagVectorIds(
  database: SqlDatabase,
  model: LocalEmbeddingModelIdentity,
  chunks: readonly EvidenceChunk[],
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  checkAbort(signal);
  const empty = new Set<string>();
  // Never accrue an earlier verified page while later proof awaits native
  // work. Large or partly warm inputs stay on the unchanged full writer.
  if (!chunks.length || chunks.length > proofWindowSize) return empty;
  const ready = await database.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('rag_embeddings','rag_embedding_models','rag_embedding_sources','rag_embedding_removed_chunks','rag_embedding_removed_sources','rag_vector_document_revisions')",
  );
  checkAbort(signal);
  if (ready.rows.length !== 6) return empty;
  const snapshot = await read(database, model, chunks, signal);
  if (snapshot.candidates.length !== chunks.length) return empty;
  for (let index = 0; index < chunks.length; index += digestBatch) {
    checkAbort(signal);
    const same = await Promise.all(
      chunks.slice(index, index + digestBatch).map(async chunk => {
        const vector = snapshot.vectors.get(chunk.id)!;
        return (
          vector.every(value => Number.isFinite(value)) &&
          snapshot.revisions.get(chunk.id) ===
            (await vectorDocumentFingerprint(chunk, vector))
        );
      }),
    );
    if (!same.every(Boolean)) return empty;
  }
  checkAbort(signal);
  // One post-hash owning read admits the entire warm window. A partial
  // result would skip writer checks while embedding the misses; reject it.
  const current = await read(database, model, chunks, signal);
  checkAbort(signal);
  if (current.candidates.length !== chunks.length) return empty;
  for (const { id } of current.candidates) {
    const before = snapshot.vectors.get(id)!;
    const after = current.vectors.get(id);
    if (
      current.revisions.get(id) !== snapshot.revisions.get(id) ||
      after?.length !== before.length ||
      after.some((value, index) => value !== before[index])
    )
      return empty;
  }
  return new Set(chunks.map(chunk => chunk.id));
}
