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
  isConversationPhotoSource,
} from '../ragConversation/conversationArtifactSources';

/** Logical tombstones fence retained results even before a physical record is removed. */
export async function assertConversationSourcesNotRemoved(
  tx: SqlExecutor,
  value: ConversationArtifact,
) {
  const identities: [string, string | null][] = [];
  for (const source of value.sources) {
    if (isConversationPhotoSource(source)) continue;
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
    const kinds = new Map<string, Set<string>>();
    for (const record of source.records) {
      const entries = kinds.get(record.id) ?? new Set<string>();
      entries.add(record.kind);
      kinds.set(record.id, entries);
    }
    for (const id of new Set(ids)) {
      const entries = kinds.get(id);
      if (entries) for (const kind of entries) identities.push([id, kind]);
      else identities.push([id, null]);
    }
  }
  // Keep per-source typed identity semantics; an unknown alias remains a global fence.
  // One bound JSON value avoids parameter ceilings and per-member bridge calls.
  if (!identities.length) return;
  for (const table of [
    'source_deletion_tombstones',
    'agent_memory_removed_sources',
  ]) {
    const removed = await tx.execute(
      `SELECT m.source_id FROM json_each(?) i JOIN ${table} m
       ON m.source_id = json_extract(i.value, '$[0]')
       WHERE json_extract(i.value, '$[1]') IS NULL OR
       ${markerMatchesKind(table, 'm.source_id', "json_extract(i.value, '$[1]')")} LIMIT 1`,
      [JSON.stringify(identities)],
    );
    if (removed.rows.length)
      throw new RetainedSourceInvalidError(
        'A source was removed before saving.',
      );
  }
}
