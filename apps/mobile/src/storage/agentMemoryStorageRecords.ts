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
    'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json',
    [record.id, serialized],
  );
}

/** Delete only absent memories so compaction does not erase artifacts linked to surviving rows. */
export async function reconcileAgentMemoryRecords(
  transaction: SqlTransaction,
  records: readonly PersistedMemoryRecord[],
): Promise<void> {
  const existing = await transaction.execute(
    'SELECT id, record_json FROM agent_memory_records ORDER BY id',
  );
  const next = new Map(records.map(record => [record.id, record]));
  for (const row of existing.rows) {
    if (typeof row.id !== 'string')
      throw new Error('Encrypted agent-memory data is invalid.');
    if (!next.has(row.id))
      await transaction.execute(
        'DELETE FROM agent_memory_records WHERE id = ?',
        [row.id],
      );
  }
  for (const record of next.values())
    await insertAgentMemoryRecord(transaction, record);
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
