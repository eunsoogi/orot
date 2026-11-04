import type { SqlExecutor } from '@orot/storage';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import type { ConversationArtifact } from './conversationArtifactCodec';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { markerMatchesKind } from './typedDeletionMarkers';
import {
  isGeneratedSummarySource,
  isGeneratedConversationSource,
  isGeneratedResearchSource,
} from '../ragConversation/conversationArtifactSources';

/** Logical tombstones fence retained results even before a physical record is removed. */
export async function assertConversationSourcesNotRemoved(
  tx: SqlExecutor,
  value: ConversationArtifact,
) {
  for (const source of value.sources) {
    if (
      isGeneratedSummarySource(source) ||
      isGeneratedConversationSource(source) ||
      isGeneratedResearchSource(source)
    )
      continue;
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
      const records = source.records.filter(record => record.id === id);
      for (const table of [
        'source_deletion_tombstones',
        'agent_memory_removed_sources',
      ]) {
        // Identities without a typed record stay conservative: their kind is unknown.
        const condition = records.length
          ? records
              .map(record =>
                markerMatchesKind(table, 'm.source_id', `'${record.kind}'`),
              )
              .join(' OR ')
          : '1';
        const removed = await tx.execute(
          `SELECT m.source_id FROM ${table} m WHERE m.source_id = ? AND (${condition}) LIMIT 1`,
          [id],
        );
        if (removed.rows.length)
          throw new RetainedSourceInvalidError(
            'A source was removed before saving.',
          );
      }
    }
  }
}
