import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';

/** Include direct records, provenance IDs and their recording roots in removal checks. */
export function periodRowReferences(marker: string) {
  return `(h.id = ${marker} OR EXISTS
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
        `SELECT h.id FROM ${table} h CROSS JOIN (SELECT ? AS topic, ? AS from_key, ? AS to_key) p WHERE (${guard.replaceAll('OLD.', 'h.')}) AND EXISTS (SELECT 1 FROM ${marker} m WHERE ${periodRowReferences('m.source_id')}) LIMIT 1`,
        bindings,
      );
      if (result.rows.length) throw new Error('A period source was removed.');
    }
  }
}
