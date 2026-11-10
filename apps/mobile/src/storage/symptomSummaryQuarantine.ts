import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import {
  deletedSymptomIds,
  referencesDeletedSymptom,
} from './agentMemorySymptomQuarantine';
import { decodeAgentMemoryRecord } from './agentMemoryStorageRecords';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

/** A pending deletion hides saved prose derived from the symptom or quarantined memory. */
export const visibleSummary = `NOT EXISTS (
  SELECT 1 FROM symptom_summary_sources s
  JOIN legacy_symptom_deleted d ON s.record_kind = 'symptom_entry' AND d.id = s.record_id
  WHERE s.summary_id = r.id
) AND NOT EXISTS (
  SELECT 1 FROM symptom_summary_sources s JOIN agent_memory_records m ON m.id = s.record_id
  JOIN json_each(m.record_json, '$.meta.provenance.sourceIds') i
  JOIN legacy_symptom_deleted d ON d.id = i.value
  WHERE s.summary_id = r.id AND s.record_kind = 'reviewed_memory'
    AND (NOT EXISTS (SELECT 1 FROM json_each(m.record_json, '$.meta.provenance.sourceReferences') ref WHERE json_extract(ref.value, '$.id') = d.id)
      OR EXISTS (SELECT 1 FROM json_each(m.record_json, '$.meta.provenance.sourceReferences') ref WHERE json_extract(ref.value, '$.id') = d.id AND (json_extract(ref.value, '$.kind') IS NULL OR trim(json_extract(ref.value, '$.kind')) = '' OR json_extract(ref.value, '$.kind') = 'symptom_entry')))
) AND NOT EXISTS (
  SELECT 1 FROM symptom_summary_periods p JOIN symptom_entries h
  JOIN legacy_symptom_deleted d ON d.id = h.id
  WHERE p.summary_id = r.id AND p.topic = 'symptoms'
    AND ${localQueryTimestampKeyExpression("coalesce(json_extract(h.payload_json, '$.startedAt'), h.effective_at)")} >= p.from_key
    AND ${localQueryTimestampKeyExpression("coalesce(json_extract(h.payload_json, '$.startedAt'), h.effective_at)")} < p.to_key
)`;

/** Revalidate before writing so a completed model response cannot cross the fence. */
export async function assertSummarySourceAvailable(
  tx: SqlExecutor,
  kind: string,
  id: string,
  source: string,
): Promise<void> {
  const deleted = await deletedSymptomIds(tx);
  if (
    (kind === 'symptom_entry' && deleted.has(id)) ||
    (kind === 'reviewed_memory' &&
      referencesDeletedSymptom(decodeAgentMemoryRecord(source), deleted))
  ) {
    throw new RetainedSourceInvalidError(
      'A cited source was removed before saving.',
      'deleted',
    );
  }
}

/** A pending typed symptom removal fences only the affected symptom period. */
export async function assertSymptomPeriodAvailable(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
) {
  if (source.scope.topic !== 'symptoms' || !(await deletedSymptomIds(tx)).size)
    return;
  const at = localQueryTimestampKeyExpression(
    "coalesce(json_extract(h.payload_json, '$.startedAt'), h.effective_at)",
  );
  const result = await tx.execute(
    `SELECT h.id FROM symptom_entries h JOIN legacy_symptom_deleted d ON d.id = h.id WHERE ${at} >= ? AND ${at} < ? LIMIT 1`,
    [
      localQueryTimestampKey(source.scope.window.fromInclusive),
      localQueryTimestampKey(source.scope.window.toExclusive),
    ],
  );
  if (result.rows.length)
    throw new RetainedSourceInvalidError(
      'A symptom period source was removed.',
      'deleted',
    );
}
