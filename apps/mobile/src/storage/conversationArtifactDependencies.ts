import type { SqlExecutor } from '@orot/storage';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import type { ConversationArtifact } from './conversationArtifactCodec';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';

/** Logical tombstones fence retained results even before a physical record is removed. */
export async function assertConversationSourcesNotRemoved(
  tx: SqlExecutor,
  value: ConversationArtifact,
) {
  for (const source of value.sources) {
    if (isPeriodSummarySource(source)) {
      await assertPeriodNotRemoved(tx, source);
      continue;
    }
    if (source.reference.sourceKind === 'external_medical') continue;
    const ids = [
      source.reference.sourceId,
      source.reference.evidenceId,
      ...source.records.map(record => record.id),
    ];
    for (const id of ids) {
      const removed = await tx.execute(
        'SELECT source_id FROM source_deletion_tombstones WHERE source_id = ? UNION ALL SELECT source_id FROM agent_memory_removed_sources WHERE source_id = ? LIMIT 1',
        [id, id],
      );
      if (removed.rows.length)
        throw new Error('A source was removed before saving.');
    }
  }
}
