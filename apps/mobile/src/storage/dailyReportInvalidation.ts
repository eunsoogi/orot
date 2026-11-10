import type { ManualHistoryRepository, SqlExecutor } from '@orot/storage';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { assertRetainedRecordsCurrent } from './retainedRecordFreshness';
import type { DailyReportLineage } from './dailyReportStorageTypes';

/** Historical reads ignore unrelated writes but retain irreversible source-change fences. */
export async function dailyReportSourcesChanged(
  tx: SqlExecutor,
  invalid: boolean,
  lineage: DailyReportLineage[],
  history: ManualHistoryRepository,
) {
  if (invalid) return true;
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
    return false;
  } catch (error) {
    if (!(error instanceof RetainedSourceInvalidError)) throw error;
    return true;
  }
}

/** Preserve the distinction between a superseded run and a removed run on retry. */
export async function invalidDailyReportStatus(tx: SqlExecutor, runId: string) {
  const retained = await tx.execute(
    'SELECT id FROM symptom_summary_runs WHERE id = ?',
    [runId],
  );
  return retained.rows.length ? ('stale' as const) : ('deleted' as const);
}

/** Reuse the existing ancestry fence when a new revision replaces an active run. */
export async function invalidateDailyReportRun(tx: SqlExecutor, runId: string) {
  await tx.execute(
    'INSERT INTO conversation_invalid_summaries (id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries WHERE id = ?)',
    [runId, runId],
  );
}
