import { readHealthContextGeneration } from '../healthEvidence/healthContext/generation';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';

export interface DailyReportWarmCheckpointIdentity {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVersion: number;
  /** Exact closed identity of the admitted day, mode, model, scope and source snapshot. */
  readonly fingerprint: string;
}

const identifiers = (i: DailyReportWarmCheckpointIdentity) =>
  [i.requestId, i.sessionId, i.sessionVersion] as const;

async function setup(db: SqlExecutor) {
  await db.execute(`CREATE TABLE IF NOT EXISTS daily_report_warm_checkpoints (
    request_id TEXT PRIMARY KEY NOT NULL, fingerprint TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('armed', 'paused', 'claimed', 'dispatch_possible')))`);
  await db.execute(`CREATE TRIGGER IF NOT EXISTS daily_report_warm_request_deleted
    AFTER DELETE ON conversation_requests BEGIN
    DELETE FROM daily_report_warm_checkpoints WHERE request_id = OLD.id; END`);
  await db.execute(`CREATE TRIGGER IF NOT EXISTS daily_report_warm_request_retired
    AFTER UPDATE OF status, interruption_reason ON conversation_requests
    WHEN NEW.status IN ('cancelled', 'completed') OR NEW.interruption_reason = 'user-stopped' BEGIN
    DELETE FROM daily_report_warm_checkpoints WHERE request_id = NEW.id; END`);
}

/** Persistent proof for a single warm owner, never a provider or cold-relaunch grant. */
export function createDailyReportWarmCheckpoint(
  db: SqlDatabase,
  identity: DailyReportWarmCheckpointIdentity,
) {
  const i = { ...identity };
  const ids = identifiers(i);
  let prepared: Promise<void> | undefined;
  const confirm = (tx: SqlExecutor) =>
    tx.execute(
      `SELECT c.phase, r.status, r.interruption_reason
       FROM conversation_requests r
       JOIN conversation_artifact_sessions s ON s.id = r.session_id AND
         s.version = r.session_version AND s.hidden = 0
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
       LEFT JOIN daily_report_warm_checkpoints c ON c.request_id = r.id AND c.fingerprint = ?
       WHERE r.id = ? AND r.session_id = ? AND r.session_version = ?`,
      [i.fingerprint, ...ids],
    );
  async function transact(
    current: () => boolean,
    operation: (tx: SqlExecutor) => Promise<boolean>,
  ) {
    if (!current()) return false;
    prepared ??= db.transaction(setup).catch(error => {
      prepared = undefined;
      throw error;
    });
    await prepared;
    if (!current()) return false;
    let accepted = false;
    await db.transaction(async tx => {
      if (current()) accepted = await operation(tx);
    });
    return accepted && current();
  }
  return {
    arm: (current: () => boolean) =>
      transact(current, async tx => {
        const row = (await confirm(tx)).rows[0];
        if (row?.status !== 'active' || row.phase != null || !current())
          return false;
        await tx.execute(
          'INSERT OR IGNORE INTO daily_report_warm_checkpoints VALUES (?, ?, ?)',
          [i.requestId, i.fingerprint, 'armed'],
        );
        return (await confirm(tx)).rows[0]?.phase === 'armed';
      }),
    pause: (current: () => boolean) =>
      transact(current, async tx => {
        const row = (await confirm(tx)).rows[0];
        if (row?.status !== 'active' || row.phase !== 'armed' || !current())
          return false;
        await tx.execute(
          "UPDATE conversation_requests SET status = 'interrupted', interruption_reason = 'background-paused' WHERE id = ? AND session_id = ? AND session_version = ? AND status = 'active'",
          [...ids],
        );
        await tx.execute(
          "UPDATE daily_report_warm_checkpoints SET phase = 'paused' WHERE request_id = ? AND fingerprint = ? AND phase = 'armed'",
          [i.requestId, i.fingerprint],
        );
        const after = (await confirm(tx)).rows[0];
        return (
          after?.phase === 'paused' &&
          after.status === 'interrupted' &&
          after.interruption_reason === 'background-paused'
        );
      }),
    claim: (current: () => boolean) =>
      transact(current, async tx => {
        const row = (await confirm(tx)).rows[0];
        if (
          row?.status !== 'interrupted' ||
          row.phase !== 'paused' ||
          row.interruption_reason !== 'background-paused' ||
          !current()
        )
          return false;
        await tx.execute(
          "UPDATE conversation_requests SET status = 'active', interruption_reason = NULL WHERE id = ? AND session_id = ? AND session_version = ? AND status = 'interrupted' AND interruption_reason = 'background-paused'",
          [...ids],
        );
        await tx.execute(
          "UPDATE daily_report_warm_checkpoints SET phase = 'claimed' WHERE request_id = ? AND fingerprint = ? AND phase = 'paused'",
          [i.requestId, i.fingerprint],
        );
        const after = (await confirm(tx)).rows[0];
        return after?.phase === 'claimed' && after.status === 'active';
      }),
    dispatchStillCurrent: (
      current: () => boolean,
      source: { mutationGeneration: number; deletionGeneration: number },
    ) =>
      transact(current, async tx => {
        const generation = await readHealthContextGeneration(tx);
        const row = (await confirm(tx)).rows[0];
        return (
          row?.status === 'active' &&
          row.phase === 'dispatch_possible' &&
          generation.mutationGeneration === source.mutationGeneration &&
          generation.deletionGeneration === source.deletionGeneration
        );
      }),
    markDispatchPossible: (
      current: () => boolean,
      source: { mutationGeneration: number; deletionGeneration: number },
    ) =>
      transact(current, async tx => {
        const generation = await readHealthContextGeneration(tx);
        if (
          generation.mutationGeneration !== source.mutationGeneration ||
          generation.deletionGeneration !== source.deletionGeneration
        )
          return false;
        const row = (await confirm(tx)).rows[0];
        if (
          row?.status !== 'active' ||
          (row.phase !== 'armed' && row.phase !== 'claimed') ||
          !current()
        )
          return false;
        await tx.execute(
          "UPDATE daily_report_warm_checkpoints SET phase = 'dispatch_possible' WHERE request_id = ? AND fingerprint = ? AND phase IN ('armed', 'claimed')",
          [i.requestId, i.fingerprint],
        );
        return (await confirm(tx)).rows[0]?.phase === 'dispatch_possible';
      }),
  };
}
