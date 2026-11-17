import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { assertPeriodNotRemoved } from './conversationPeriodRemoval';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import type { ToolLineage } from './conversationToolLineage';

type Key = readonly [string, string, string];

export async function setupToolPeriodPolicy(tx: SqlExecutor) {
  await tx.execute(
    'CREATE TABLE IF NOT EXISTS tool_period_policy (session_id TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY(session_id,run_id,call_id))',
  );
  await tx.execute(
    'CREATE TRIGGER IF NOT EXISTS tool_period_policy_deleted AFTER DELETE ON conversation_tool_events BEGIN DELETE FROM tool_period_policy WHERE session_id=OLD.session_id AND run_id=OLD.run_id AND call_id=OLD.call_id; END',
  );
}

/** Legacy aggregates cannot prove which now-missing sample contributed. Keep encrypted
 * rows unchanged and fence the call identity, not every later capture of the same period. */
export async function legacyToolPeriodAvailable(
  tx: SqlExecutor,
  key: Key,
  sources: ToolLineage,
) {
  const policy = await tx.execute(
    'SELECT status FROM tool_period_policy WHERE session_id=? AND run_id=? AND call_id=?',
    [...key],
  );
  if (policy.rows.length) return policy.rows[0]?.status === 'current';
  let available = true;
  for (const source of sources) {
    if (!('kind' in source) || source.kind !== 'health_context_period')
      continue;
    const period = source;
    if (!['measurements', 'activity'].includes(period.scope.topic)) continue;
    try {
      await assertPeriodNotRemoved(tx, period);
      await assertSummaryPeriodCurrent(tx, period, true);
    } catch (error) {
      if (!(error instanceof RetainedSourceInvalidError)) throw error;
      available = false;
      break;
    }
  }
  await markToolPeriodPolicy(tx, key, available);
  return available;
}

export async function markToolPeriodPolicy(
  tx: SqlExecutor,
  key: Key,
  available: boolean,
) {
  await tx.execute(
    'INSERT OR IGNORE INTO tool_period_policy VALUES (?,?,?,?)',
    [...key, available ? 'current' : 'quarantined'],
  );
}

/** Metadata contains no event payload or source text; regeneration must use a new call identity. */
export function unavailableToolMetadata(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (sessionId: string) => {
    await ensure();
    const result = await database.execute(
      `SELECT e.message_id, e.created_at, e.run_id, e.call_id FROM conversation_tool_events e JOIN tool_period_policy p USING(session_id,run_id,call_id) JOIN conversation_artifact_sessions s ON s.id=e.session_id AND s.hidden=0 JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation WHERE e.session_id=? AND p.status='quarantined'`,
      [sessionId],
    );
    return result.rows.map(row => ({
      messageId: String(row.message_id),
      createdAt: String(row.created_at),
      runId: String(row.run_id),
      callId: String(row.call_id),
      reason: 'unverifiable_legacy_period' as const,
      recovery: 'regenerate' as const,
    }));
  };
}
