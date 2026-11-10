import type { SqlExecutor } from '@orot/storage';

/** Preserve the distinction between a superseded run and a removed run on retry. */
export async function invalidDailyReportStatus(
  tx: SqlExecutor,
  key: string,
  runId: string,
) {
  const active = await tx.execute(
    'SELECT active_run_id FROM daily_report_heads WHERE identity_key = ?',
    [key],
  );
  const retained = await tx.execute(
    'SELECT id FROM symptom_summary_runs WHERE id = ?',
    [runId],
  );
  return retained.rows.length && active.rows[0]?.active_run_id !== runId
    ? ('stale' as const)
    : ('deleted' as const);
}

/** Reuse the existing ancestry fence when a new revision replaces an active run. */
export async function invalidateDailyReportRun(tx: SqlExecutor, runId: string) {
  await tx.execute(
    'INSERT INTO conversation_invalid_summaries (id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM conversation_invalid_summaries WHERE id = ?)',
    [runId, runId],
  );
}
