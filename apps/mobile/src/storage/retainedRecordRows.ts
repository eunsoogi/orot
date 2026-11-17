import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import type { SavedRecordSummarySource } from '../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

type Reference = SavedRecordSummarySource['records'][number];
export const retainedRecordKey = (record: Pick<Reference, 'kind' | 'id'>) =>
  JSON.stringify([record.kind, record.id]);

/** Fetch every selected record and its stale marker inside the caller's transaction.
 * One bound JSON ID set per kind avoids per-sample bridge round trips and SQLite's
 * variable limit. No cross-call cache or record/byte ceiling weakens revalidation. */
export async function readRetainedRecordRows(
  tx: SqlExecutor,
  records: readonly Reference[],
) {
  const unique = new Map<string, Reference>();
  const groups = new Map<Reference['kind'], string[]>();
  for (const record of records) {
    const key = retainedRecordKey(record);
    const previous = unique.get(key);
    if (previous && previous.revision !== record.revision)
      throw new RetainedSourceInvalidError(
        'A cited source has conflicting saved revisions.',
        'changed',
      );
    if (previous) continue;
    unique.set(key, record);
    const ids = groups.get(record.kind) ?? [];
    ids.push(record.id);
    groups.set(record.kind, ids);
  }
  const rows = new Map<string, { serialized: string; stale: boolean }>();
  for (const [kind, ids] of groups) {
    if (kind === 'manual_history') continue;
    const memory = kind === 'reviewed_memory';
    const table = memory ? 'agent_memory_records' : STORAGE_TABLES[kind].table;
    const column = memory ? 'record_json' : 'payload_json';
    const result = await tx.execute(
      `SELECT r.id, r.${column} AS source_json,
        EXISTS (SELECT 1 FROM transcript_artifact_staleness s
          WHERE s.artifact_kind = ? AND s.artifact_id = r.id) AS stale
       FROM ${table} r WHERE r.id IN (SELECT value FROM json_each(?))`,
      [kind, JSON.stringify(ids)],
    );
    for (const row of result.rows) {
      if (
        typeof row.id !== 'string' ||
        typeof row.source_json !== 'string' ||
        (row.stale !== 0 && row.stale !== 1)
      )
        throw new RetainedSourceInvalidError('A cited source is invalid.');
      rows.set(retainedRecordKey({ kind, id: row.id }), {
        serialized: row.source_json,
        stale: row.stale === 1,
      });
    }
  }
  return { records: [...unique.values()], rows };
}
