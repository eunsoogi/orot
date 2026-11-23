import { RecordIdSchema } from '@orot/domain';
import { STORAGE_TABLES, type RecordKind } from './contracts';
import { sourceDeletionDependencyPredicate } from './sourceDeletionReferences';
import type { SqlDatabase } from './sql';

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
