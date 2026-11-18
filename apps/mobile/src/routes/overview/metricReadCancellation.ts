import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { ensureHealthContextGeneration } from '../../healthEvidence/healthContext/generation';

/** Cancel only this overview read, never the shared native connection. A local
 * sentinel exits after commit so same-connection interleaved deletions survive.
 * Real SQL/setup failures retain the driver's existing rollback behavior. */
export async function readOverviewMetricSnapshot<T>(
  database: SqlDatabase,
  signal: AbortSignal | undefined,
  read: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  const cancelled = new Error('Overview metric read was cancelled.');
  const check = () => {
    if (signal?.aborted) throw cancelled;
  };
  check();
  let value!: T;
  let wasCancelled = false;
  await database.transaction(async tx => {
    try {
      // A queued obsolete read performs no SQL in its callback. Native BEGIN/
      // COMMIT remain driver-owned; no connection-wide interrupt is requested.
      check();
      // Preparation installs a coherent guard set. Do not abandon partial DDL
      // or turn cancellation into a rollback of another caller's DELETE.
      await ensureHealthContextGeneration(tx);
      check();
      const executor: SqlExecutor = {
        async execute(query, bindings) {
          check();
          const result = await tx.execute(query, bindings);
          // Check only after success: an actual SQL error wins over concurrent
          // cancellation and still follows the original rollback contract.
          check();
          return result;
        },
      };
      value = await read(executor);
      check();
    } catch (error) {
      if (error !== cancelled) throw error;
      wasCancelled = true;
    }
  });
  if (wasCancelled) throw cancelled;
  // Commit and callback scheduling can race disposal too; never publish late.
  check();
  return value;
}
