import type { SyncCheckpoint } from './contracts';
import type { SqlExecutor } from './sql';

/** Reject malformed persisted checkpoint values before they reach a sync caller. */
export async function readSyncCheckpoint(
  executor: SqlExecutor,
  key: string,
): Promise<SyncCheckpoint | null> {
  const result = await executor.execute(
    'SELECT checkpoint_key, value, updated_at FROM healthkit_sync_checkpoints WHERE checkpoint_key = ? LIMIT 1',
    [key],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (
    typeof row.checkpoint_key !== 'string' ||
    typeof row.value !== 'string' ||
    typeof row.updated_at !== 'string'
  )
    throw new Error('A stored HealthKit sync checkpoint is invalid.');
  return { key: row.checkpoint_key, value: row.value, updatedAt: row.updated_at };
}
