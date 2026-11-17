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
