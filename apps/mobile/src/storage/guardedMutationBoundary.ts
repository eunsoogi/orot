import type { SqlExecutor, SqlResult, SqlTransaction } from '@orot/storage';

export function protectedSqlRead(query: string): boolean {
  if (/^PRAGMA (?:schema_version|data_version|compile_options)$/i.test(query))
    return true;
  return (
    /^[\t \r\n]*SELECT\b/i.test(query) &&
    !query.includes(';') &&
    !/\b(?:load_extension|writefile|eval)\s*\(/i.test(query)
  );
}

type GuardPhase = 'retirement' | 'submission' | 'settlement';
type Outcome = 'started' | 'completed' | 'failed';
export type GuardedMutationBoundary = (
  phase: GuardPhase,
  outcome: Outcome,
) => void;

/** Retirement stays synchronous and precedes all native calls. Submission only
 * measures the synchronous adapter invocation; its Promise settling is not a
 * native scheduler timestamp or a measurement of SQLite execution alone. */
export function dispatchGuardedMutation<R>(
  listeners: Set<() => void> | undefined,
  call: () => R,
  trace?: GuardedMutationBoundary,
): R {
  const retireOwners = () => {
    if (listeners)
      for (const retire of listeners) {
        retire();
        listeners.delete(retire);
      }
  };
  if (!trace) {
    retireOwners();
    return call();
  }
  const phase = <T>(stage: GuardPhase, work: () => T): T => {
    trace?.(stage, 'started');
    try {
      const value = work();
      trace?.(stage, 'completed');
      return value;
    } catch (error) {
      trace?.(stage, 'failed');
      throw error;
    }
  };
  phase('retirement', retireOwners);
  const result = phase('submission', call);
  if (
    !result ||
    typeof (result as unknown as PromiseLike<unknown>).then !== 'function'
  )
    return result;
  trace('settlement', 'started');
  return Promise.resolve(result).then(
    value => {
      trace('settlement', 'completed');
      return value;
    },
    error => {
      trace('settlement', 'failed');
      throw error;
    },
  ) as R;
}

export const manualHistoryMemoryDelete =
  'DELETE FROM manual_history_entries WHERE id = ?';
export const tracedMemoryDelete = Symbol('owned saved Memory deletion');
type ScopedMemoryDelete = {
  [tracedMemoryDelete]?: (id: string) => Promise<SqlResult>;
};

/** The capability carries one fixed statement and expires when the owning
 * transaction callback completes, even if a later caller retained its executor. */
export function withOwnedMemoryDelete(
  operation: (tx: SqlTransaction) => Promise<void>,
  executor: SqlTransaction & ScopedMemoryDelete,
  execute?: (id: string) => Promise<SqlResult>,
) {
  if (!execute) return operation(executor);
  let active = true;
  executor[tracedMemoryDelete] = id => {
    if (!active)
      return Promise.reject(
        new Error('The deletion owner is no longer active.'),
      );
    return execute(id);
  };
  return (async () => {
    try {
      await operation(executor);
    } finally {
      active = false;
    }
  })();
}

/** Untraced owners and synthetic executors retain the original behavior. */
export function savedMemoryDeleteExecutor(executor: SqlExecutor) {
  return (executor as SqlExecutor & ScopedMemoryDelete)[tracedMemoryDelete];
}
