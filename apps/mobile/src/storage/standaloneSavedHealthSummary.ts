import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { visibleSummary } from './symptomSummaryQuarantine';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import type { SavedSymptomSummary } from '../diseaseHypotheses/savedSummaries';

/** Share committed body checks with the Memory bookmark without granting current evidence access. */
export async function readStandaloneSavedHealthSummaryRow(
  tx: SqlExecutor,
  identity: Pick<SavedSymptomSummary, 'id' | 'createdAt'>,
) {
  const { rows } = await tx.execute(
    `SELECT r.result_json, i.id IS NOT NULL AS source_revision FROM symptom_summary_runs r
       JOIN summary_period_policy p ON p.summary_id = r.id AND p.status = 'current'
       LEFT JOIN conversation_invalid_summaries i ON i.id = r.id
       LEFT JOIN standalone_summary_body_receipts b ON b.summary_id = r.id
       WHERE r.id = ? AND r.created_at = ? AND (${visibleSummary})
         AND NOT EXISTS (SELECT 1 FROM daily_report_revisions d WHERE d.run_id = r.id)
         AND (i.id IS NULL OR b.source_revision = 1)`,
    [identity.id, identity.createdAt],
  );
  const serialized = rows[0]?.result_json;
  const saved = decodeSavedSymptomSummary(serialized);
  return typeof serialized === 'string' &&
    saved?.id === identity.id &&
    saved.createdAt === identity.createdAt &&
    saved.inputLineage === 'complete' &&
    saved.analysis.presentation === 'symptom_summary'
    ? { saved, serialized, sourceRevision: rows[0]?.source_revision === 1 }
    : null;
}

/** A standalone archive selection is an exact committed row, not access to
 * current evidence. Ambiguous legacy invalidations never authorize its body. */
export async function readStandaloneSavedHealthSummary(
  database: SqlDatabase,
  identity: Pick<SavedSymptomSummary, 'id' | 'createdAt'>,
  signal: AbortSignal,
) {
  const selection: {
    value: Awaited<ReturnType<typeof readStandaloneSavedHealthSummaryRow>>;
  } = { value: null };
  if (signal.aborted) return null;
  await database.transaction(async tx => {
    if (!signal.aborted)
      selection.value = await readStandaloneSavedHealthSummaryRow(tx, identity);
  });
  return signal.aborted ? null : selection.value;
}
