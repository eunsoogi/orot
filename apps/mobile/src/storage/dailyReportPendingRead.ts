import type { SqlDatabase } from '@orot/storage';
import { parseDailyRecoveryCandidate } from './dailyReportRecoveryCandidate';

/** Internal normalized pending candidates. UI callers must project metadata only.
 * A read is not proof of freshness or authority; resume repeats all final fences. */
export async function readDailyReportPending(
  database: SqlDatabase,
  identityKey: string,
) {
  let candidates: NonNullable<
    ReturnType<typeof parseDailyRecoveryCandidate>
  >[] = [];
  await database.transaction(async tx => {
    const exists = await tx.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_report_pending_publication'",
    );
    if (!exists.rows.length) return;
    const rows = await tx.execute(
      'SELECT candidate_json FROM daily_report_pending JOIN daily_report_pending_publication USING(run_id) WHERE identity_key = ? AND candidate_json IS NOT NULL',
      [identityKey],
    );
    candidates = rows.rows.flatMap(row => {
      if (typeof row.candidate_json !== 'string') return [];
      try {
        const candidate = parseDailyRecoveryCandidate(
          JSON.parse(row.candidate_json),
        );
        return candidate ? [candidate] : [];
      } catch {
        return [];
      }
    });
  });
  return candidates;
}
