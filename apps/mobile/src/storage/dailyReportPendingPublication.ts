import { validateDailyReportSave } from './dailyReportLineage';
import type { SqlDatabase } from '@orot/storage';
import type { DailyReportSave } from './dailyReportStorageTypes';
import type { DailyReportRecoveryWitness } from './dailyReportRecoveryWitness';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';

/** Staging bytes are private until final checks and this commit succeed. This
 * durable marker is discoverability, never authority or a cached freshness proof. */
export async function publishDailyReportPending(
  database: SqlDatabase,
  candidate: DailyReportSave,
  identity: DailyReportRecoveryWitness['identity'],
  isCurrent: () => boolean,
) {
  const checked = validateDailyReportSave(candidate);
  if (!checked) return false;
  let published = false;
  await database.transaction(async tx => {
    const generation = await readHealthContextGeneration(tx);
    if (
      !isCurrent() ||
      generation.mutationGeneration !==
        checked.context.sourceSnapshot.mutationGeneration ||
      generation.deletionGeneration !==
        checked.context.sourceSnapshot.deletionGeneration
    )
      return;
    const row = (
      await tx.execute(
        'SELECT candidate_json, owner_json FROM daily_report_pending WHERE run_id = ?',
        [candidate.runId],
      )
    ).rows[0];
    if (
      !isCurrent() ||
      row?.candidate_json !== JSON.stringify(candidate) ||
      row.owner_json !== stableJson(identity)
    )
      return;
    const inserted = await tx.execute(
      'INSERT OR IGNORE INTO daily_report_pending_publication(run_id) SELECT run_id FROM daily_report_pending WHERE run_id = ? AND candidate_json = ? AND owner_json = ?',
      [candidate.runId, JSON.stringify(candidate), stableJson(identity)],
    );
    if (!isCurrent()) {
      await tx.execute(
        'DELETE FROM daily_report_pending_publication WHERE run_id = ?',
        [candidate.runId],
      );
      return;
    }
    // A concurrent source invalidation may have removed the matching candidate.
    published =
      inserted.rowsAffected === 1 ||
      !!(
        await tx.execute(
          'SELECT run_id FROM daily_report_pending_publication JOIN daily_report_pending USING(run_id) WHERE run_id = ? AND candidate_json = ?',
          [candidate.runId, JSON.stringify(candidate)],
        )
      ).rows.length;
  });
  return published && isCurrent();
}

/** Already-initialized staging uses one queued tombstone transaction, so an
 * abort queues invalidation before any later metadata reader can acquire the DB. */
export async function cancelDailyReportPending(
  database: SqlDatabase,
  runId: string,
) {
  await database.transaction(async tx => {
    await tx.execute(
      "INSERT INTO daily_report_pending VALUES (?, '', NULL, '{}') ON CONFLICT(run_id) DO UPDATE SET candidate_json = NULL",
      [runId],
    );
  });
}
