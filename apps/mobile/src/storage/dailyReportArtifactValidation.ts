import type { ManualHistoryRepository, SqlExecutor } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { assertRetainedRecordsCurrent } from './retainedRecordFreshness';
import { parseDailyReportLineage } from './dailyReportLineage';
import { validateDailyReportCompletion } from './dailyReportValidation';
import { visibleSummary } from './symptomSummaryQuarantine';

/** Validate the active pointer, generation and every source in one database snapshot. */
export async function validateDailyReportArtifact(
  tx: SqlExecutor,
  id: string,
  history: ManualHistoryRepository,
) {
  const row = (
    await tx.execute(
      `SELECT r.result_json, h.revision, h.identity_key FROM symptom_summary_runs r JOIN daily_report_heads h ON h.active_run_id = r.id AND h.deleted = 0 JOIN daily_report_revisions d ON d.run_id = r.id AND d.identity_key = h.identity_key AND d.revision = h.revision WHERE r.id = ? AND ${visibleSummary} AND NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries i WHERE i.id = r.id)`,
      [id],
    )
  ).rows[0];
  if (typeof row?.result_json !== 'string' || typeof row.revision !== 'number')
    return null;
  let raw: { context?: unknown; report?: unknown; lineage?: unknown };
  try {
    raw = JSON.parse(row.result_json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const checked = validateDailyReportCompletion(raw.context, {
    status: 'completed',
    report: raw.report,
  });
  if (!checked || checked.context.identity.key !== row.identity_key)
    return null;
  const lineage = parseDailyReportLineage(checked.context, raw.lineage);
  if (!lineage) return null;
  const generation = await readHealthContextGeneration(tx);
  if (
    generation.mutationGeneration !==
      checked.context.sourceSnapshot.mutationGeneration ||
    generation.deletionGeneration !==
      checked.context.sourceSnapshot.deletionGeneration
  )
    return null;
  try {
    await assertRetainedRecordsCurrent(
      tx,
      lineage.map(item => ({
        kind: item.kind,
        id: item.localId,
        revision: item.revision,
      })),
      history,
    );
  } catch {
    return null;
  }
  return {
    ...checked,
    lineage,
    runId: id,
    revision: row.revision,
    fingerprint: fingerprint({
      runId: id,
      revision: row.revision,
      context: checked.context,
      report: checked.report,
      lineage,
    }),
  };
}
