import type { SqlExecutor } from '@orot/storage';
import { appendConversationPeriod } from './conversationPeriodCutoff';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import {
  isConversationPhotoSource,
  isGeneratedConversationSource,
  isGeneratedResearchSource,
  isGeneratedSummarySource,
} from '../ragConversation/conversationArtifactSources';
import type { ConversationArtifact } from './conversationArtifactCodec';

/** Insert every dependency in the owning transaction without a native bridge call per member.
 * Bound JSON preserves typed identities and avoids SQLite's variable-count ceiling. */
export async function appendConversationSourceRows(
  tx: SqlExecutor,
  value: ConversationArtifact,
) {
  const records: [string, string][] = [];
  for (const source of value.sources) {
    if (isConversationPhotoSource(source)) continue;
    if (
      isGeneratedSummarySource(source) ||
      isGeneratedConversationSource(source) ||
      isGeneratedResearchSource(source)
    ) {
      records.push([source.kind, source.id]);
    } else if (isPeriodSummarySource(source)) {
      // Periods are few and must preserve the shared max-cutoff/unbounded merge contract.
      await appendConversationPeriod(tx, value.id, source.scope);
    } else {
      if (source.reference.sourceKind !== 'external_medical')
        for (const id of [
          source.reference.sourceId,
          source.reference.evidenceId,
        ])
          records.push(['identity', id]);
      for (const record of source.records)
        records.push([record.kind, record.id]);
    }
  }
  if (records.length)
    await tx.execute(
      `INSERT OR IGNORE INTO conversation_artifact_sources (artifact_id, record_kind, record_id)
     SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
      [value.id, JSON.stringify(records)],
    );
}
