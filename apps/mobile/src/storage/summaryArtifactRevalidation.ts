import { legacySummaryPeriodAvailable } from './legacySummaryPeriodQuarantine';
import {
  createReadOnlyPeriodValidation,
  type ReadOnlyPeriodValidation,
} from './readOnlyPeriodValidation';
import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { visibleSummary } from './symptomSummaryQuarantine';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';
import { validateDailyReportArtifact } from './dailyReportArtifactValidation';

/** All admitted summaries and their source revisions must share one database snapshot. */
export async function revalidateSummaryArtifacts(
  database: SqlDatabase,
  items: readonly { readonly id: string; readonly revision: string }[],
): Promise<boolean> {
  const history = createManualHistoryRepository(database);
  let valid = true;
  await database.transaction(async tx => {
    // This batch performs no writes; only identical period recalculations are shared.
    const validatePeriod = createReadOnlyPeriodValidation(tx);
    for (const item of items) {
      const daily = await tx.execute(
        'SELECT run_id FROM daily_report_revisions WHERE run_id = ?',
        [item.id],
      );
      if (daily.rows.length) {
        const current = await validateDailyReportArtifact(tx, item.id, history);
        if (!current || current.fingerprint !== item.revision) {
          valid = false;
          return;
        }
        continue;
      }
      if (
        !(await readCurrentRetainedSummary(tx, item, history, validatePeriod))
      ) {
        valid = false;
        return;
      }
    }
  });
  return valid;
}

/** Read the exact supported snapshot with the same lineage checks used by the generated artifact catalog. */
export async function readCurrentRetainedSummary(
  tx: SqlExecutor,
  item: { readonly id: string; readonly revision: string },
  history: ReturnType<typeof createManualHistoryRepository>,
  validatePeriod: ReadOnlyPeriodValidation,
) {
  const result = await tx.execute(
    `SELECT r.result_json FROM symptom_summary_runs r WHERE r.id = ? AND ${visibleSummary} AND NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries invalid WHERE invalid.id = r.id)`,
    [item.id],
  );
  const saved = decodeSavedSymptomSummary(result.rows[0]?.result_json);
  if (
    !saved ||
    saved.inputLineage !== 'complete' ||
    fingerprint(saved) !== item.revision
  )
    return null;
  try {
    if (!(await legacySummaryPeriodAvailable(tx, saved))) return null;
    await assertRetainedEvidenceCurrent(
      tx,
      saved.sources,
      history,
      false,
      undefined,
      validatePeriod,
    );
    return saved;
  } catch {
    return null;
  }
}
