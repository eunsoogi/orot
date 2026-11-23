import type { SqlDatabase } from '@orot/storage';
import { visibleSummary } from './symptomSummaryQuarantine';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import type { SavedSymptomSummary } from '../diseaseHypotheses/savedSummaries';

/** A standalone archive selection is an exact committed row, not access to
 * current evidence. Ambiguous legacy invalidations never authorize its body. */
export async function readStandaloneSavedHealthSummary(
  database: SqlDatabase,
  identity: Pick<SavedSymptomSummary, 'id' | 'createdAt'>,
  signal: AbortSignal,
) {
  const selection: {
    value: { saved: SavedSymptomSummary; serialized: string } | null;
  } = { value: null };
  if (signal.aborted) return null;
  await database.transaction(async tx => {
    if (signal.aborted) return;
    const { rows } = await tx.execute(
      `SELECT r.result_json FROM symptom_summary_runs r
       JOIN summary_period_policy p ON p.summary_id = r.id AND p.status = 'current'
       WHERE r.id = ? AND r.created_at = ? AND (${visibleSummary})
         AND NOT EXISTS (SELECT 1 FROM daily_report_revisions d WHERE d.run_id = r.id)
         AND NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = r.id)`,
      [identity.id, identity.createdAt],
    );
    const serialized = rows[0]?.result_json;
    const saved = decodeSavedSymptomSummary(serialized);
    if (
      !signal.aborted &&
      typeof serialized === 'string' &&
      saved?.id === identity.id &&
      saved.createdAt === identity.createdAt &&
      saved.inputLineage === 'complete' &&
      saved.analysis.presentation === 'symptom_summary'
    )
      selection.value = { saved, serialized };
  });
  return signal.aborted ? null : selection.value;
}
