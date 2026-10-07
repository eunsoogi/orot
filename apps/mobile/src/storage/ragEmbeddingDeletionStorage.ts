import type { LocalEmbeddingWrite } from '@orot/rag';
import type { SqlExecutor } from '@orot/storage';

const EMBEDDINGS_TABLE = 'rag_embeddings';
const EMBEDDING_MODELS_TABLE = 'rag_embedding_models';
const EMBEDDING_SOURCES_TABLE = 'rag_embedding_sources';
const REMOVED_CHUNKS_TABLE = 'rag_embedding_removed_chunks';
const REMOVED_SOURCES_TABLE = 'rag_embedding_removed_sources';

export async function ensureRagEmbeddingDeletionSchema(
  executor: SqlExecutor,
): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${REMOVED_CHUNKS_TABLE} (chunk_id TEXT PRIMARY KEY NOT NULL)`,
  );
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${REMOVED_SOURCES_TABLE} (source_record_id TEXT PRIMARY KEY NOT NULL)`,
  );
  const sourceMap = await executor.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [EMBEDDING_SOURCES_TABLE],
  );
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${EMBEDDING_SOURCES_TABLE} (chunk_id TEXT NOT NULL, source_record_id TEXT NOT NULL, PRIMARY KEY (chunk_id, source_record_id))`,
  );
  await executor.execute(
    `CREATE INDEX IF NOT EXISTS rag_embedding_sources_source_idx ON ${EMBEDDING_SOURCES_TABLE} (source_record_id, chunk_id)`,
  );
  if (sourceMap.rows.length === 0) {
    // Unmapped rows are disposable cache; durable tombstones are reserved for explicit deletion.
    await executor.execute(`DELETE FROM ${EMBEDDINGS_TABLE}`);
    await executor.execute(`DELETE FROM ${EMBEDDING_MODELS_TABLE}`);
  }
}

export async function upsertRagEmbeddingSources(
  executor: SqlExecutor,
  chunkId: string,
  sourceRecordIds: readonly string[],
): Promise<void> {
  const uniqueSourceIds = [...new Set(sourceRecordIds)];
  await executor.execute(
    `DELETE FROM ${EMBEDDING_SOURCES_TABLE} WHERE chunk_id = ?`,
    [chunkId],
  );
  if (uniqueSourceIds.length === 0) return;
  await executor.execute(
    `INSERT OR IGNORE INTO ${EMBEDDING_SOURCES_TABLE} (chunk_id, source_record_id) SELECT ?, value FROM json_each(?)`,
    [chunkId, JSON.stringify(uniqueSourceIds)],
  );
}

export async function assertRagEvidenceNotRemoved(
  executor: SqlExecutor,
  entries: readonly LocalEmbeddingWrite[],
): Promise<void> {
  const sourceRecordIds = [
    ...new Set(entries.flatMap(entry => entry.sourceRecordIds)),
  ];
  const removedSource = await executor.execute(
    `SELECT source_record_id FROM ${REMOVED_SOURCES_TABLE} WHERE source_record_id IN (SELECT value FROM json_each(?)) LIMIT 1`,
    [JSON.stringify(sourceRecordIds)],
  );
  const removedChunk = await executor.execute(
    `SELECT chunk_id FROM ${REMOVED_CHUNKS_TABLE} WHERE chunk_id IN (SELECT value FROM json_each(?)) LIMIT 1`,
    [JSON.stringify(entries.map(entry => entry.chunkId))],
  );
  if (removedSource.rows.length > 0 || removedChunk.rows.length > 0) {
    throw new Error('Removed evidence cannot be indexed again.');
  }
}

/** Reads matching tombstones and checks source-row existence only for root source IDs. */
export async function findRemovedRagEvidence(
  executor: SqlExecutor,
  sourceRecordIds: readonly string[],
  chunkIds: readonly string[],
  rootSourceRecordIds: readonly string[],
): Promise<{
  sourceRecordIds: readonly string[];
  chunkIds: readonly string[];
}> {
  const [removedSources, missingSources, removedChunks] = await Promise.all([
    sourceRecordIds.length === 0
      ? Promise.resolve({ rows: [] as readonly Record<string, unknown>[] })
      : executor.execute(
          `SELECT source_record_id FROM ${REMOVED_SOURCES_TABLE} WHERE source_record_id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify([...new Set(sourceRecordIds)])],
        ),
    rootSourceRecordIds.length === 0
      ? Promise.resolve({ rows: [] as readonly Record<string, unknown>[] })
      : executor.execute(
          `SELECT requested.value AS source_record_id FROM json_each(?) AS requested WHERE NOT EXISTS (SELECT 1 FROM source_records WHERE id = requested.value)`,
          [JSON.stringify([...new Set(rootSourceRecordIds)])],
        ),
    chunkIds.length === 0
      ? Promise.resolve({ rows: [] as readonly Record<string, unknown>[] })
      : executor.execute(
          `SELECT chunk_id FROM ${REMOVED_CHUNKS_TABLE} WHERE chunk_id IN (SELECT value FROM json_each(?))`,
          [JSON.stringify([...new Set(chunkIds)])],
        ),
  ]);
  // A pre-migration graph may still hold chunks whose root source row vanished before tombstones existed.
  const removedSourceIds = new Set<string>();
  for (const row of [...removedSources.rows, ...missingSources.rows]) {
    if (typeof row.source_record_id === 'string')
      removedSourceIds.add(row.source_record_id);
  }
  return {
    sourceRecordIds: [...removedSourceIds],
    chunkIds: removedChunks.rows.flatMap(row =>
      typeof row.chunk_id === 'string' ? [row.chunk_id] : [],
    ),
  };
}

/** Fences source and chunk identities in the same transaction that removes their vectors. */
export async function deleteRagEvidence(
  executor: SqlExecutor,
  sourceRecordIds: readonly string[],
  chunkIds: readonly string[],
): Promise<void> {
  const uniqueSourceIds = [...new Set(sourceRecordIds.filter(Boolean))];
  const uniqueChunkIds = [...new Set(chunkIds.filter(Boolean))];
  if (uniqueSourceIds.length > 0) {
    await executor.execute(
      `INSERT OR IGNORE INTO ${REMOVED_SOURCES_TABLE} (source_record_id) SELECT value FROM json_each(?)`,
      [JSON.stringify(uniqueSourceIds)],
    );
  }
  const associatedChunks =
    uniqueSourceIds.length === 0
      ? []
      : await executor
          .execute(
            `SELECT DISTINCT chunk_id FROM ${EMBEDDING_SOURCES_TABLE} WHERE source_record_id IN (SELECT value FROM json_each(?))`,
            [JSON.stringify(uniqueSourceIds)],
          )
          .then(result =>
            result.rows.flatMap(row =>
              typeof row.chunk_id === 'string' ? [row.chunk_id] : [],
            ),
          );
  const allChunkIds = [...new Set([...uniqueChunkIds, ...associatedChunks])];
  if (allChunkIds.length > 0) {
    const idsJson = JSON.stringify(allChunkIds);
    await executor.execute(
      `INSERT OR IGNORE INTO ${REMOVED_CHUNKS_TABLE} (chunk_id) SELECT value FROM json_each(?)`,
      [idsJson],
    );
    await executor.execute(
      `DELETE FROM ${EMBEDDINGS_TABLE} WHERE chunk_id IN (SELECT value FROM json_each(?))`,
      [idsJson],
    );
    await executor.execute(
      `DELETE FROM ${EMBEDDING_SOURCES_TABLE} WHERE chunk_id IN (SELECT value FROM json_each(?))`,
      [idsJson],
    );
  }
}

/** Fences every mapped source and chunk before removing the complete vector index. */
export async function clearRagEvidence(
  executor: SqlExecutor,
  sourceRecordIds: readonly string[],
): Promise<void> {
  const uniqueSourceIds = [...new Set(sourceRecordIds.filter(Boolean))];
  if (uniqueSourceIds.length > 0) {
    await executor.execute(
      `INSERT OR IGNORE INTO ${REMOVED_SOURCES_TABLE} (source_record_id) SELECT value FROM json_each(?)`,
      [JSON.stringify(uniqueSourceIds)],
    );
  }
  // A full clear can receive no source list, so persist fences from the map before deleting it.
  await executor.execute(
    `INSERT OR IGNORE INTO ${REMOVED_SOURCES_TABLE} (source_record_id) SELECT DISTINCT source_record_id FROM ${EMBEDDING_SOURCES_TABLE}`,
  );
  await executor.execute(
    `INSERT OR IGNORE INTO ${REMOVED_CHUNKS_TABLE} (chunk_id) SELECT DISTINCT chunk_id FROM ${EMBEDDINGS_TABLE}`,
  );
  await executor.execute(
    `INSERT OR IGNORE INTO ${REMOVED_CHUNKS_TABLE} (chunk_id) SELECT DISTINCT chunk_id FROM ${EMBEDDING_SOURCES_TABLE}`,
  );
  await executor.execute(`DELETE FROM ${EMBEDDINGS_TABLE}`);
  await executor.execute(`DELETE FROM ${EMBEDDING_SOURCES_TABLE}`);
  await executor.execute(`DELETE FROM ${EMBEDDING_MODELS_TABLE}`);
}
