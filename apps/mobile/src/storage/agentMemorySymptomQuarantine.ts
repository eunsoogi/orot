import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import { decodeAgentMemoryRecord } from './agentMemoryStorageRecords';

async function readDeletedSymptomIds(
  sql: SqlExecutor,
  ids?: ReadonlySet<string>,
): Promise<Set<string>> {
  const table = await sql.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'legacy_symptom_deleted'",
  );
  if (!table.rows.length) return new Set();
  const result = ids
    ? await sql.execute(
        `SELECT id FROM legacy_symptom_deleted WHERE id IN (${[...ids].map(() => '?').join(', ')})`,
        [...ids],
      )
    : await sql.execute('SELECT id FROM legacy_symptom_deleted');
  return new Set(
    result.rows.flatMap(row => (typeof row.id === 'string' ? [row.id] : [])),
  );
}

/** Legacy rows with ambiguous provenance stay stored but cannot become AI evidence. */
export function deletedSymptomIds(sql: SqlExecutor): Promise<Set<string>> {
  return readDeletedSymptomIds(sql);
}

const selectedSymptomIdLimit = 128;
const selectedSymptomTextLimit = 8192;

interface SymptomQuarantineSelection {
  matches(requestedIds: readonly string[]): Set<string> | undefined;
}

/** RAG needs only membership for its selected aliases, not the whole quarantine.
 * Keep the old single-statement snapshot for large or nonportable bindings;
 * never split an authority decision across independently timed reads.
 */
export async function readSelectedSymptomQuarantine(
  sql: SqlExecutor,
  requestedIds: readonly string[],
): Promise<SymptomQuarantineSelection> {
  const selected = new Set(requestedIds);
  const unsuitable =
    selected.size > selectedSymptomIdLimit ||
    [...selected].reduce((length, id) => length + id.length, 0) >
      selectedSymptomTextLimit ||
    [...selected].some(id => id.includes('\0'));
  if (unsuitable) {
    const deleted = await deletedSymptomIds(sql);
    return { matches: () => deleted };
  }
  const deleted = selected.size
    ? await readDeletedSymptomIds(sql, selected)
    : new Set<string>();
  // Recheck synchronously where the reader or writer will consume the result,
  // including after the promise resolves or when no SQL lookup was needed.
  return {
    matches: current =>
      current.every(id => selected.has(id)) ? deleted : undefined,
  };
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

export async function symptomQuarantineRevision(
  sql: SqlExecutor,
): Promise<string> {
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
