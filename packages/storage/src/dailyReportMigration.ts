import type { SqlExecutor } from './sql';

/** Keep report identity metadata in the encrypted database alongside summary runs. */
export async function createDailyReportTables(transaction: SqlExecutor): Promise<void> {
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS daily_report_heads (identity_key TEXT PRIMARY KEY NOT NULL, active_run_id TEXT, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)))',
  );
  await transaction.execute(
    'CREATE TABLE IF NOT EXISTS daily_report_revisions (identity_key TEXT NOT NULL, revision INTEGER NOT NULL, run_id TEXT NOT NULL UNIQUE, PRIMARY KEY (identity_key, revision))',
  );
}
