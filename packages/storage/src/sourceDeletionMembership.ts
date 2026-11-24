import { RecordIdSchema } from '@orot/domain';
import { STORAGE_TABLES, type RecordKind } from './contracts';
import {
  SOURCE_DELETION_TOMBSTONES_TABLE,
  sourceDeletionDependencyPredicate,
} from './sourceDeletionReferences';
import type { SqlDatabase } from './sql';
import { decodeStoredRecord } from './recordPersistence';

const belongsToSource = [
  'wanted.value = ?2',
  `EXISTS (SELECT 1 FROM evidence_spans
    WHERE evidence_spans.id = wanted.value
      AND json_extract(payload_json, '$.sourceRecordId') = ?2)`,
  `EXISTS (SELECT 1 FROM transcript_segments
    WHERE transcript_segments.id = wanted.value AND json_extract(payload_json, '$.recordingSourceId') = ?2)`,
  ...(Object.keys(STORAGE_TABLES) as RecordKind[])
    .filter((kind) => !['source_record', 'evidence_span', 'transcript_segment'].includes(kind))
    .map((kind) => {
      const table = STORAGE_TABLES[kind].table;
      return `EXISTS (SELECT 1 FROM ${table} WHERE ${table}.id = wanted.value
        AND ${sourceDeletionDependencyPredicate(kind, table, '?2')})`;
    }),
  `EXISTS (SELECT 1 FROM transcript_segments
    WHERE json_extract(payload_json, '$.transcriptId') = wanted.value
      AND json_extract(payload_json, '$.recordingSourceId') = ?2)`,
];
const membership = `SELECT (EXISTS (SELECT 1 FROM source_records WHERE id = ?2) AND NOT EXISTS (
    SELECT 1 FROM json_each(?1) AS wanted WHERE NOT (${belongsToSource.join(' OR ')})
  )) AS all_live`;
const pageSize = 50;

/** Test only requested descendants using the same deletion predicates, not the
 * writer's full descendant enumeration. A result never crosses freshness passes. */
export async function hasExactSourceDeletionReferences(
  database: SqlDatabase,
  sourceRecordId: string,
  referenceIds: readonly string[],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted || referenceIds.length === 0) return false;
  const sourceId = RecordIdSchema.parse(sourceRecordId);
  const ids = [...new Set(referenceIds.map((id) => RecordIdSchema.parse(id)))];
  let complete = false;
  await database.transaction(async (tx) => {
    for (let offset = 0; offset < ids.length; offset += pageSize) {
      if (signal.aborted) return;
      const result = await tx.execute(membership, [
        JSON.stringify(ids.slice(offset, offset + pageSize)),
        sourceId,
      ]);
      if (signal.aborted || result.rows[0]?.all_live !== 1) return;
    }
    complete = true;
  });
  return complete && !signal.aborted;
}

/** Check one imported source and all exact IDs in one SQLite statement. An
 * absent source keeps the app's existing structured-record fallback. */
async function readExactSourceDeletionGroup(
  database: SqlDatabase,
  sourceRecordId: string,
  referenceIds: readonly string[],
  signal: AbortSignal,
): Promise<'current' | 'missing_source' | 'rejected'> {
  if (signal.aborted || referenceIds.length === 0) return 'rejected';
  const sourceId = RecordIdSchema.parse(sourceRecordId);
  const ids = [...new Set(referenceIds.map((id) => RecordIdSchema.parse(id)))];
  if (!ids.includes(sourceId) || ids.length > pageSize) return 'rejected';
  const result = await database.execute(
    `SELECT state, CASE WHEN state = 'current' THEN payload_json ELSE NULL END AS payload_json
    FROM (SELECT CASE
      WHEN EXISTS (
        SELECT 1 FROM ${SOURCE_DELETION_TOMBSTONES_TABLE} AS removed
        JOIN json_each(?1) AS wanted ON wanted.value = removed.source_id
      ) THEN 'rejected'
      WHEN source.id IS NULL THEN 'missing_source'
      WHEN EXISTS (
        SELECT 1 FROM json_each(?1) AS wanted WHERE NOT (${belongsToSource.join(' OR ')})
      ) THEN 'rejected'
      ELSE 'current'
    END AS state, source.payload_json
    FROM (SELECT 1) AS one LEFT JOIN source_records AS source ON source.id = ?2)`,
    [JSON.stringify(ids), sourceId],
  );
  if (signal.aborted) return 'rejected';
  const state = result.rows[0]?.state;
  if (state === 'current') decodeStoredRecord('source_record', result.rows[0]?.payload_json);
  return state === 'current' || state === 'missing_source' ? state : 'rejected';
}

export const sourceDeletionGroupReader =
  (database: SqlDatabase) => (sourceId: string, ids: readonly string[], signal: AbortSignal) =>
    readExactSourceDeletionGroup(database, sourceId, ids, signal);
