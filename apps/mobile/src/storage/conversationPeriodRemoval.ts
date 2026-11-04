import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { markerMatchesKind } from './typedDeletionMarkers';

/** Include direct records, provenance IDs and their recording roots in removal checks. */
export function periodRowReferences(
  marker: string,
  markerTable?: string,
  recordKind?: string,
) {
  const direct =
    markerTable && recordKind
      ? markerMatchesKind(markerTable, marker, `'${recordKind}'`)
      : '1';
  // Provenance references are not typed, so any matching deletion must still fence them.
  return `((h.id = ${marker} AND ${direct}) OR EXISTS
    (SELECT 1 FROM json_each(h.payload_json, '$.provenance.sourceRecordIds') linked
     LEFT JOIN transcript_segments segment ON segment.id = linked.value OR json_extract(segment.payload_json, '$.transcriptId') = linked.value
     WHERE linked.value = ${marker} OR json_extract(segment.payload_json, '$.recordingSourceId') = ${marker}))`;
}

/** Existing markers must also fence a period captured after a logical removal. */
export async function assertPeriodNotRemoved(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
) {
  const bindings = [
    source.scope.topic,
    localQueryTimestampKey(source.scope.window.fromInclusive),
    localQueryTimestampKey(source.scope.window.toExclusive),
  ];
  for (const [table, guard] of Object.entries(healthPeriodDeletionGuards())) {
    for (const marker of [
      'source_deletion_tombstones',
      'agent_memory_removed_sources',
    ]) {
      const result = await tx.execute(
        `SELECT h.id FROM ${table} h CROSS JOIN (SELECT ? AS topic, ? AS from_key, ? AS to_key) p WHERE (${guard.replaceAll('OLD.', 'h.')}) AND EXISTS (SELECT 1 FROM ${marker} m WHERE ${periodRowReferences('m.source_id', marker, ({ health_observations: 'health_observation', medication_definitions: 'medication_definition', medication_assertions: 'medication_assertion', dose_events: 'dose_event', symptom_entries: 'symptom_entry' } as Record<string, string>)[table])}) LIMIT 1`,
        bindings,
      );
      if (result.rows.length)
        throw new RetainedSourceInvalidError('A period source was removed.');
    }
  }
}
