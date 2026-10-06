import type { SqlExecutor, SqlTransaction } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';

/** Transcript corrections append superseding revisions, so every prior ID is stale memory provenance. */
export async function listSupersededTranscriptRevisionIds(
  executor: SqlExecutor,
): Promise<Set<string>> {
  const result = await executor.execute(
    "SELECT DISTINCT json_extract(payload_json, '$.supersedesId') AS source_id FROM transcript_segments WHERE json_extract(payload_json, '$.supersedesId') IS NOT NULL ORDER BY source_id",
  );
  return new Set(
    result.rows.flatMap(row =>
      typeof row.source_id === 'string' ? [row.source_id] : [],
    ),
  );
}

export function referencesAnySource(
  record: PersistedMemoryRecord,
  sourceIds: Set<string>,
): boolean {
  const provenance = record.meta.provenance;
  if (!provenance || typeof provenance !== 'object') return false;
  const recordSourceIds = (provenance as { sourceIds?: unknown }).sourceIds;
  return (
    Array.isArray(recordSourceIds) &&
    recordSourceIds.some(
      sourceId => typeof sourceId === 'string' && sourceIds.has(sourceId),
    )
  );
}

export function assertNoSourceReference(
  record: PersistedMemoryRecord,
  sourceIds: Set<string>,
  message: string,
): void {
  if (referencesAnySource(record, sourceIds)) throw new Error(message);
}

export async function insertAgentMemoryRecord(
  transaction: SqlTransaction,
  record: PersistedMemoryRecord,
): Promise<void> {
  const serialized = JSON.stringify({
    ...record,
    vector: Array.from(record.vector),
  });
  await transaction.execute(
    'INSERT OR REPLACE INTO agent_memory_records (id, record_json) VALUES (?, ?)',
    [record.id, serialized],
  );
}

export function decodeAgentMemoryRecord(value: unknown): PersistedMemoryRecord {
  if (typeof value !== 'string')
    throw new Error('Encrypted agent-memory data is invalid.');
  const parsed = JSON.parse(value) as Omit<PersistedMemoryRecord, 'vector'> & {
    vector?: unknown;
  };
  if (
    typeof parsed.id !== 'string' ||
    typeof parsed.text !== 'string' ||
    !Array.isArray(parsed.vector) ||
    parsed.vector.some(vectorValue => typeof vectorValue !== 'number') ||
    !Array.isArray(parsed.tags) ||
    !Array.isArray(parsed.entities) ||
    typeof parsed.importance !== 'number' ||
    !parsed.meta ||
    typeof parsed.meta !== 'object' ||
    typeof parsed.createdAt !== 'number' ||
    typeof parsed.reinforcements !== 'number'
  ) {
    throw new Error('Encrypted agent-memory data is invalid.');
  }
  return {
    ...parsed,
    vector: Float32Array.from(parsed.vector),
  } as PersistedMemoryRecord;
}
