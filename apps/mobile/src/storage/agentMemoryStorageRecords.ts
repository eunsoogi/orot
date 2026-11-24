import type { SqlExecutor, SqlTransaction } from '@orot/storage';
import { projectDefaultSavedMemory } from '@orot/agent-memory';
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

const recentMemoryMetadataVersion = 1;

/** Attests only the exact canonical persisted snapshot. Old or ineligible rows
 * cannot enter the future clock index merely because their JSON has a timestamp. */
export function projectRecentAgentMemoryWitness(
  id: string,
  serialized: string,
) {
  try {
    const record = decodeAgentMemoryRecord(serialized);
    const saved = projectDefaultSavedMemory(record);
    if (
      !saved ||
      id !== saved.id ||
      !Number.isSafeInteger(saved.createdAt) ||
      saved.provenance.sourceIds.length !== 0 ||
      (saved.provenance.reviewState !== 'user_confirmed' &&
        saved.provenance.reviewState !== 'human_reviewed')
    )
      return null;
    return { version: recentMemoryMetadataVersion, createdAt: saved.createdAt };
  } catch {
    // Invalid persisted shapes remain unattested, never reclassified.
    return null;
  }
}

export async function insertAgentMemoryRecord(
  transaction: SqlTransaction,
  record: PersistedMemoryRecord,
): Promise<boolean> {
  const serialized = JSON.stringify({
    ...record,
    vector: Array.from(record.vector),
  });
  const saved = await transaction.execute(
    'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json WHERE agent_memory_records.record_json IS NOT excluded.record_json',
    [record.id, serialized],
  );
  const witness = projectRecentAgentMemoryWitness(record.id, serialized);
  if (!witness && (saved.rowsAffected ?? 0) > 0) return true;
  const version = witness?.version ?? null;
  const clock = witness?.createdAt ?? null;
  const attested = await transaction.execute(
    `UPDATE agent_memory_records
      SET recent_metadata_version=?, recent_created_at_ms=?, recent_legacy_pending=0
      WHERE id=? AND record_json=? AND
        (recent_metadata_version IS NOT ? OR recent_created_at_ms IS NOT ? OR recent_legacy_pending <> 0)`,
    [version, clock, record.id, serialized, version, clock],
  );
  if ((attested.rowsAffected ?? 0) === 0 && witness) {
    const committed = await transaction.execute(
      `SELECT 1 AS exact FROM agent_memory_records
        WHERE id=? AND record_json=? AND recent_metadata_version=? AND recent_created_at_ms=?
          AND recent_legacy_pending=0`,
      [record.id, serialized, version, clock],
    );
    if (committed.rows.length !== 1)
      throw new Error('Agent memory changed before its metadata was attested.');
  }
  return (saved.rowsAffected ?? 0) > 0 || (attested.rowsAffected ?? 0) > 0;
}

/** Delete only absent memories so compaction does not erase artifacts linked to surviving rows. */
export async function reconcileAgentMemoryRecords(
  transaction: SqlTransaction,
  records: readonly PersistedMemoryRecord[],
): Promise<boolean> {
  let changed = false;
  const existing = await transaction.execute(
    'SELECT id, record_json FROM agent_memory_records ORDER BY id',
  );
  const next = new Map(records.map(record => [record.id, record]));
  for (const row of existing.rows) {
    if (typeof row.id !== 'string')
      throw new Error('Encrypted agent-memory data is invalid.');
    if (!next.has(row.id)) {
      const deleted = await transaction.execute(
        'DELETE FROM agent_memory_records WHERE id = ?',
        [row.id],
      );
      changed = (deleted.rowsAffected ?? 0) > 0 || changed;
    }
  }
  for (const record of next.values())
    changed = (await insertAgentMemoryRecord(transaction, record)) || changed;
  return changed;
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
