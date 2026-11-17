import {
  singletonProvenance,
  singletonProvenanceValue,
  fallbackProvenance,
  periodRecordKinds,
} from './periodRemovalIndexes';
import { markerMatchesKind } from './typedDeletionMarkers';

/** Query-only membership keeps marker IDs as indexed lookup keys. The trigger predicate
 * remains separate: its OLD row/marker correlation has a different query shape.
 * Direct IDs honor typed markers; untyped provenance and recording roots remain conservative.
 * The empty-set gate is in the same statement, never a racy preflight read. */
export function periodRemovalMembership(
  markerTable: string,
  recordKind: string,
) {
  return `EXISTS (SELECT 1 FROM ${markerTable} LIMIT 1) AND (
    EXISTS (SELECT 1 FROM ${markerTable} m WHERE m.source_id = h.id
      AND ${markerMatchesKind(markerTable, 'm.source_id', `'${recordKind}'`)})
    OR EXISTS (SELECT 1 FROM json_each(h.payload_json, '$.provenance.sourceRecordIds') linked
      WHERE EXISTS (SELECT 1 FROM ${markerTable} m WHERE m.source_id = linked.value)
        OR EXISTS (SELECT 1 FROM transcript_segments segment
          WHERE (segment.id = linked.value OR json_extract(segment.payload_json, '$.transcriptId') = linked.value)
            AND EXISTS (SELECT 1 FROM ${markerTable} m
              WHERE m.source_id = json_extract(segment.payload_json, '$.recordingSourceId'))))
  )`;
}

/** Marker-driven direct/string-singleton lookup, with an exact legacy fallback.
 * UNION only deduplicates candidates; contributor/time guards still apply to each.
 * Recording roots expand inside this statement so marker inserts cannot race a precheck. */
export function periodRemovalQuery(
  table: string,
  marker: string,
  guard: string,
  candidate: string,
) {
  const kind = periodRecordKinds[table as keyof typeof periodRecordKinds];
  const qualify = (sql: string) =>
    sql.replaceAll('payload_json', 'h.payload_json');
  const filter = `(${candidate}) AND (${guard.replaceAll('OLD.', 'h.')})`;
  return `SELECT id FROM (
    WITH p AS (SELECT ? AS topic, ? AS from_key, ? AS to_key),
    linked_ids(id) AS (
      SELECT source_id FROM ${marker}
      UNION SELECT segment.id FROM ${marker} m CROSS JOIN transcript_segments segment
        WHERE json_extract(segment.payload_json, '$.recordingSourceId') = m.source_id
      UNION SELECT json_extract(segment.payload_json, '$.transcriptId') FROM ${marker} m CROSS JOIN transcript_segments segment
        WHERE json_extract(segment.payload_json, '$.recordingSourceId') = m.source_id AND json_type(segment.payload_json, '$.transcriptId') = 'text'
    )
    SELECT h.id FROM ${marker} m CROSS JOIN ${table} h CROSS JOIN p
      WHERE h.id = m.source_id AND ${markerMatchesKind(marker, 'm.source_id', `'${kind}'`)} AND ${filter}
    UNION SELECT h.id FROM linked_ids linked CROSS JOIN ${table} h INDEXED BY ${table}_period_singleton CROSS JOIN p
      WHERE ${qualify(singletonProvenance)} AND ${qualify(singletonProvenanceValue)} = linked.id AND ${filter}
    UNION SELECT h.id FROM p CROSS JOIN ${table} h INDEXED BY ${table}_period_fallback
      WHERE ${qualify(fallbackProvenance)} AND ${filter} AND (${periodRemovalMembership(marker, kind)})
  ) LIMIT 1`;
}
