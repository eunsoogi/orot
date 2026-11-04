import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import { decodeAgentMemoryRecord } from './agentMemoryStorageRecords';

/** Legacy rows with ambiguous provenance stay stored but cannot become AI evidence. */
export async function deletedSymptomIds(
  sql: SqlExecutor,
): Promise<Set<string>> {
  const table = await sql.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'legacy_symptom_deleted'",
  );
  if (!table.rows.length) return new Set();
  const result = await sql.execute('SELECT id FROM legacy_symptom_deleted');
  return new Set(
    result.rows.flatMap(row => (typeof row.id === 'string' ? [row.id] : [])),
  );
}

/** Full local-data deletion must include records hidden from ordinary memory reads. */
export async function listAllMemoryRecords(
  sql: SqlExecutor,
): Promise<PersistedMemoryRecord[]> {
  const result = await sql.execute(
    'SELECT record_json FROM agent_memory_records ORDER BY id',
  );
  return result.rows.map(row => decodeAgentMemoryRecord(row.record_json));
}

export async function symptomQuarantineRevision(sql: SqlExecutor): Promise<string> {
  return JSON.stringify([...(await deletedSymptomIds(sql))].sort());
}

/** An untyped legacy reference is ambiguous; only an explicit different kind remains usable. */
export function referencesDeletedSymptom(
  record: PersistedMemoryRecord,
  deleted: Set<string>,
): boolean {
  const provenance = record.meta.provenance;
  if (!provenance || typeof provenance !== 'object') return false;
  const { sourceIds, sourceReferences } = provenance as {
    sourceIds?: unknown;
    sourceReferences?: unknown;
  };
  if (!Array.isArray(sourceIds)) return false;
  return sourceIds.some(id => {
    if (typeof id !== 'string' || !deleted.has(id)) return false;
    if (!Array.isArray(sourceReferences)) return true;
    const refs = sourceReferences.filter(
      ref => ref && typeof ref === 'object' && ref.id === id,
    );
    return (
      !refs.length ||
      refs.some(
        ref =>
          typeof ref.kind !== 'string' ||
          !ref.kind.trim() ||
          ref.kind === 'symptom_entry',
      )
    );
  });
}

/** A full compaction must never physically discard quarantined user-approved rows. */
export async function assertSafeSymptomCompaction(
  sql: SqlExecutor,
  records: PersistedMemoryRecord[],
): Promise<void> {
  const deleted = await deletedSymptomIds(sql);
  const stored = await sql.execute(
    'SELECT record_json FROM agent_memory_records',
  );
  if (
    stored.rows.some(row =>
      referencesDeletedSymptom(
        decodeAgentMemoryRecord(row.record_json),
        deleted,
      ),
    )
  ) {
    throw new Error('Quarantined memory cannot be removed by compaction.');
  }
  if (records.some(record => referencesDeletedSymptom(record, deleted))) {
    throw new Error('Memory cannot reference a deleted symptom.');
  }
}
