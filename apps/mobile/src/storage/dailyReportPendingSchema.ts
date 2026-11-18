import { STORAGE_TABLES, type SqlExecutor } from '@orot/storage';
import { dailyRecoveryKinds } from './dailyReportRecoveryCandidate';

/** Pending output is not a saved report. Invalidations erase prose but retain its run tombstone. */
export async function setupDailyReportPending(tx: SqlExecutor) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS daily_report_pending (
    run_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, candidate_json TEXT,
    owner_json TEXT NOT NULL)`);
  await tx.execute(`CREATE TABLE IF NOT EXISTS daily_report_pending_sources (
    run_id TEXT NOT NULL REFERENCES daily_report_pending(run_id) ON DELETE CASCADE,
    record_kind TEXT NOT NULL, local_id TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(run_id, record_kind, local_id))`);
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS daily_report_pending_source ON daily_report_pending_sources(record_kind, local_id)',
  );
  const present = new Set(
    (
      await tx.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    ).rows.map(row => row.name),
  );
  const tables = [
    ...Object.entries(STORAGE_TABLES).map(([kind, item]) => [kind, item.table]),
  ];
  for (const [kind, table] of tables) {
    if (!dailyRecoveryKinds.has(kind!) || !present.has(table)) continue;
    for (const event of ['DELETE', 'UPDATE']) {
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS daily_pending_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} BEGIN
        UPDATE daily_report_pending SET candidate_json = NULL WHERE run_id IN
          (SELECT run_id FROM daily_report_pending_sources WHERE record_kind = '${kind}' AND local_id = OLD.id);
        END`);
    }
  }
  // A pending candidate promises the exact source generation, not just selected rows.
  // Logical removals also fail closed for legacy/provenance aliases whose kinds are unknown.
  for (const [table, event] of [
    ['health_context_generation', 'UPDATE'],
    ['source_deletion_tombstones', 'INSERT'],
    ['agent_memory_removed_sources', 'INSERT'],
    ['legacy_symptom_deleted', 'INSERT'],
  ]) {
    if (!present.has(table)) continue;
    await tx.execute(`CREATE TRIGGER IF NOT EXISTS daily_pending_${table}_${event.toLowerCase()}
      AFTER ${event} ON ${table} BEGIN UPDATE daily_report_pending SET candidate_json = NULL; END`);
  }
  if (present.has('daily_report_heads')) {
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = event === 'DELETE' ? 'OLD' : 'NEW';
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS daily_pending_head_${event.toLowerCase()}
        AFTER ${event} ON daily_report_heads BEGIN
        UPDATE daily_report_pending SET candidate_json = NULL WHERE identity_key = ${row}.identity_key;
        END`);
    }
  }
  if (present.has('transcript_artifact_staleness')) {
    for (const event of ['INSERT', 'UPDATE'])
      await tx.execute(`CREATE TRIGGER IF NOT EXISTS daily_pending_staleness_${event.toLowerCase()}
      AFTER ${event} ON transcript_artifact_staleness BEGIN
      UPDATE daily_report_pending SET candidate_json = NULL WHERE run_id IN
        (SELECT run_id FROM daily_report_pending_sources WHERE record_kind = NEW.artifact_kind AND local_id = NEW.artifact_id);
      END`);
  }
}
