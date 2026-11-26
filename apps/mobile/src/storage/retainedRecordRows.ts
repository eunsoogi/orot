import {
  STORAGE_TABLES,
  type SqlExecutor,
  type SqlResult,
} from '@orot/storage';
import { currentEvidenceCondition } from '../healthEvidence/evidenceCandidateScope';
import type { SavedRecordSummarySource } from '../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

type Reference = SavedRecordSummarySource['records'][number];
export const retainedRecordKey = (record: Pick<Reference, 'kind' | 'id'>) =>
  JSON.stringify([record.kind, record.id]);

export function orderedRetainedRecords(records: readonly Reference[]) {
  const unique = new Map<string, Reference>();
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
  }
  return [...unique.values()];
}

export function checkedRetainedRow(row: SqlResult['rows'][number]) {
  if (
    typeof row.id !== 'string' ||
    typeof row.source_json !== 'string' ||
    (row.stale !== 0 && row.stale !== 1) ||
    (row.superseded !== undefined &&
      row.superseded !== 0 &&
      row.superseded !== 1)
  )
    throw new RetainedSourceInvalidError('A cited source is invalid.');
  return {
    id: row.id,
    serialized: row.source_json,
    stale: row.stale === 1,
    ...(row.superseded === 1 ? { superseded: true as const } : {}),
  };
}

/** Fetch every selected record and its stale marker inside the caller's transaction.
 * One bound JSON ID set per kind avoids per-sample bridge round trips and SQLite's
 * variable limit. No cross-call cache or record/byte ceiling weakens revalidation. */
export async function readRetainedRecordRows(
  tx: SqlExecutor,
  records: readonly Reference[],
) {
  const ordered = orderedRetainedRecords(records);
  const groups = new Map<Reference['kind'], string[]>();
  for (const record of ordered) {
    const ids = groups.get(record.kind) ?? [];
    ids.push(record.id);
    groups.set(record.kind, ids);
  }
  const rows = new Map<
    string,
    {
      serialized: string;
      stale: boolean;
      superseded?: true;
    }
  >();
  for (const [kind, ids] of groups) {
    if (kind === 'manual_history') continue;
    const memory = kind === 'reviewed_memory';
    const table = memory ? 'agent_memory_records' : STORAGE_TABLES[kind].table;
    const column = memory ? 'record_json' : 'payload_json';
    // Keep ordinary invalidation separate from the latest revision bit. A
    // current excerpt can retain immutable predecessors as lineage only.
    const latest =
      kind === 'transcript_segment'
        ? `, NOT (${currentEvidenceCondition(kind)}) AS superseded`
        : '';
    const result = await tx.execute(
      `SELECT r.id, r.${column} AS source_json,
        EXISTS (SELECT 1 FROM transcript_artifact_staleness s
          WHERE s.artifact_kind = ? AND s.artifact_id = r.id) AS stale${latest}
       FROM ${table} r WHERE r.id IN (SELECT value FROM json_each(?))`,
      [kind, JSON.stringify(ids)],
    );
    for (const row of result.rows) {
      if (latest && row.superseded === undefined)
        throw new RetainedSourceInvalidError('A cited transcript is invalid.');
      const { id, ...current } = checkedRetainedRow(row);
      rows.set(retainedRecordKey({ kind, id }), current);
    }
  }
  return { records: ordered, rows };
}
