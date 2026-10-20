import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { SavedPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { ensureHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import { readHealthContextReport } from '../healthEvidence/healthContext/reader';
import { healthContextRevision } from '../healthEvidence/healthContext/scope';
import { healthPeriodDeletionGuards } from './healthPeriodDependencies';

/** Period dependencies are bounded scopes, not thousands of raw IDs or retained deleted health values. */
export async function setupSummaryPeriods(tx: SqlExecutor) {
  await ensureHealthContextGeneration(tx);
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS symptom_summary_periods (summary_id TEXT NOT NULL REFERENCES symptom_summary_runs(id) ON DELETE CASCADE, topic TEXT NOT NULL, from_key TEXT NOT NULL, to_key TEXT NOT NULL, PRIMARY KEY(summary_id, topic, from_key, to_key))',
  );
  // Native SQLCipher connections may leave foreign_keys off. Purge dependencies in the same delete regardless.
  await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_period_run_deleted AFTER DELETE ON symptom_summary_runs BEGIN
    DELETE FROM symptom_summary_periods WHERE summary_id = OLD.id; END`);
  const guards = healthPeriodDeletionGuards();
  for (const [table, guard] of Object.entries(guards)) {
    // Direct repository deletes and provenance cascades both traverse these same triggers.
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_period_deleted_${table} AFTER DELETE ON ${table} BEGIN
      DELETE FROM symptom_summary_runs WHERE id IN (SELECT p.summary_id FROM symptom_summary_periods p WHERE ${guard}); END`);
    // A later delete must not lose its dependency merely because the event moved out of the saved scope first.
    const nextGuard = guard.replaceAll('OLD.', 'NEW.');
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS summary_period_moved_${table} AFTER UPDATE ON ${table} BEGIN
      DELETE FROM symptom_summary_runs WHERE id IN (SELECT p.summary_id FROM symptom_summary_periods p WHERE (${guard}) AND NOT coalesce((${nextGuard}), 0)); END`);
  }
}

/** Recalculate within the caller's write transaction; deletion/replacement cannot race the derived result insert. */
export async function assertSummaryPeriodCurrent(
  tx: SqlExecutor,
  source: SavedPeriodSummarySource,
) {
  const report = await readHealthContextReport(tx, source.scope.window, [
    source.scope.topic,
  ]);
  if (
    report.deletionGeneration !== source.deletionGeneration ||
    healthContextRevision(source.scope, report) !== source.revision
  )
    throw new Error('The cited health period changed before saving.');
}

export async function appendSummaryPeriod(
  tx: SqlExecutor,
  id: string,
  source: SavedPeriodSummarySource,
) {
  await tx.execute(
    'INSERT OR IGNORE INTO symptom_summary_periods (summary_id, topic, from_key, to_key) VALUES (?, ?, ?, ?)',
    [
      id,
      source.scope.topic,
      localQueryTimestampKey(source.scope.window.fromInclusive),
      localQueryTimestampKey(source.scope.window.toExclusive),
    ],
  );
}
