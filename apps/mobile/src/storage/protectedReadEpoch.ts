import {
  dispatchGuardedMutation,
  withOwnedMemoryDelete,
  manualHistoryMemoryDelete,
  protectedSqlRead,
  type GuardedMutationBoundary,
} from './guardedMutationBoundary';
export { protectedSqlRead } from './guardedMutationBoundary';
import type { SqlDatabase } from '@orot/storage';
import {
  settleKnownIndependentRead,
  type ReadSettlement,
} from './independentReadSettlement';
type Epoch = {
  readonly ownerIdentity: object;
  active: number;
  mutation: number;
  pending: number;
  dirtyTransactions: number;
  unsettledFailure?: boolean;
  detached?: boolean;
  settleListeners?: Set<() => void>;
  preDispatchRetirements?: Set<() => void>;
};
const epochs = new WeakMap<SqlDatabase, Epoch>();
/** Only secure production open or real SQLite test setup authorizes this gateway.
 * Any possible mutation/control that enters during a witness invalidates before dispatch. */
export function guardedNativeDatabase<T extends SqlDatabase>(
  native: T,
  deleteTrace?: GuardedMutationBoundary,
): T {
  const epoch: Epoch = {
    ownerIdentity: {},
    active: 0,
    mutation: 0,
    pending: 0,
    dirtyTransactions: 0,
  };
  const openTransactions = new Set<{ dirty: boolean }>();
  const markDirty = (scope: { dirty: boolean }) => {
    if (scope.dirty) return;
    scope.dirty = true;
    epoch.dirtyTransactions++;
  };
  const notifySettlement = () => {
    if (epoch.pending === 0 && epoch.dirtyTransactions === 0)
      epoch.settleListeners?.forEach(listener => listener());
  };
  const track = <R>(call: () => R, trace?: GuardedMutationBoundary): R => {
    // Direct execute shares the native connection with tx.execute. Either can
    // make an admitted callback dirty, and op-sqlite commits after it returns.
    for (const transaction of openTransactions) markDirty(transaction);
    epoch.mutation++;
    epoch.pending++;
    const finish = () => {
      epoch.pending--;
      epoch.mutation++;
      notifySettlement();
    };
    try {
      const result = dispatchGuardedMutation(
        epoch.preDispatchRetirements,
        call,
        trace,
      );
      if (
        result &&
        typeof (result as unknown as PromiseLike<unknown>).then === 'function'
      )
        return Promise.resolve(result).finally(finish) as R;
      finish();
      return result;
    } catch (error) {
      finish();
      throw error;
    }
  };
  const query = <R>(sql: string, call: () => R) =>
    protectedSqlRead(sql) ? call() : track(call);
  const execute: SqlDatabase['execute'] = (sql, binds) =>
    query(sql, () => native.execute(sql, binds));
  const transaction: SqlDatabase['transaction'] = async operation => {
    const scope = { dirty: false };
    let callbackFailure: { error: unknown } | undefined;
    try {
      await native.transaction(async tx => {
        openTransactions.add(scope);
        if (epoch.pending !== 0) markDirty(scope);
        try {
          await withOwnedMemoryDelete(
            operation,
            {
              execute: (sql, binds) => query(sql, () => tx.execute(sql, binds)),
              commit: () => track(() => tx.commit()),
              rollback: () => track(() => tx.rollback()),
            },
            deleteTrace &&
              (id =>
                track(
                  () => tx.execute(manualHistoryMemoryDelete, [id]),
                  deleteTrace,
                )),
          );
        } catch (error) {
          callbackFailure = { error };
          throw error;
        }
      });
    } catch (error) {
      if (scope.dirty && (!callbackFailure || callbackFailure.error !== error))
        epoch.unsettledFailure = true;
      throw error;
    } finally {
      openTransactions.delete(scope);
      if (scope.dirty) epoch.dirtyTransactions--;
      notifySettlement();
    }
  };
  const proxy = new Proxy(native, {
    get(target, key) {
      if (key === 'execute') return execute;
      if (key === 'transaction') return transaction;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      if (key === 'prepareStatement')
        return (...args: unknown[]) => {
          // A detached native prepared handle can outlive this dispatch.
          epoch.detached = true;
          return track(() => value.apply(target, args));
        };
      if (
        key === 'executeSync' ||
        key === 'executeRaw' ||
        key === 'executeRawSync' ||
        key === 'executeRawAsync' ||
        key === 'executeWithHostObjects' ||
        key === 'reactiveExecute' ||
        key === 'setReservedBytes' ||
        key === 'interrupt' ||
        key === 'attach' ||
        key === 'detach' ||
        key === 'executeBatch' ||
        key === 'loadFile' ||
        key === 'loadExtension' ||
        key === 'sync' ||
        key === 'close' ||
        key === 'closeAsync' ||
        key === 'delete'
      )
        return (...args: unknown[]) => track(() => value.apply(target, args));
      return value.bind(target);
    },
  });
  epochs.set(proxy, epoch);
  return proxy;
}
export function aliasProtectedReadEpoch(
  owner: SqlDatabase,
  facade: SqlDatabase,
) {
  const epoch = epochs.get(owner);
  if (epoch) epochs.set(facade, epoch);
}
export function independentReadMutation(owner: SqlDatabase) {
  const e = epochs.get(owner);
  if (
    e &&
    !e.detached &&
    !e.unsettledFailure &&
    !e.dirtyTransactions &&
    !e.pending
  )
    return e.mutation;
}
export function acquireProtectedReadEpoch(owner: SqlDatabase) {
  return acquireEpoch(owner, false);
}
/** A different native connection cannot see a dirty transaction until commit.
 * Same-connection protected algorithms keep their existing admission rules. */
export function acquireIndependentReadEpoch(owner: SqlDatabase) {
  return acquireEpoch(owner, true);
}
function acquireEpoch(owner: SqlDatabase, independent: boolean) {
  const epoch = epochs.get(owner);
  if (
    !epoch ||
    epoch.detached ||
    epoch.pending !== 0 ||
    (independent && (epoch.dirtyTransactions !== 0 || epoch.unsettledFailure))
  )
    return;
  epoch.active++;
  const start = epoch.mutation;
  let active = true;
  const current = () =>
    active &&
    !epoch.detached &&
    start === epoch.mutation &&
    (!independent ||
      (epoch.dirtyTransactions === 0 && !epoch.unsettledFailure));
  return {
    current,
    beforeDispatch(retire: () => void) {
      if (!independent || !current()) return;
      const listeners = (epoch.preDispatchRetirements ??= new Set());
      listeners.add(retire);
      return () => {
        listeners.delete(retire);
      };
    },
    dispose() {
      if (active) epoch.active--;
      active = false;
    },
  };
}
export function awaitIndependentReadSettlement(
  owner: SqlDatabase,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return readSettlement(
    owner,
    timeoutMs,
    signal,
    outcome => outcome === 'settled',
  );
}
export function awaitIndependentReadSettlementResult(
  owner: SqlDatabase,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return readSettlement(owner, timeoutMs, signal, outcome => outcome);
}
function readSettlement<R>(
  owner: SqlDatabase,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  result: (outcome: ReadSettlement) => R,
) {
  const epoch = epochs.get(owner);
  if (!epoch) return Promise.resolve(result('owner_missing'));
  return settleKnownIndependentRead(epoch, timeoutMs, signal, result);
}
export function protectedDatabaseOwnerIdentity(
  owner: SqlDatabase,
): object | undefined {
  return epochs.get(owner)?.ownerIdentity;
}
