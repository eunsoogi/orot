import {
  dispatchGuardedMutation,
  withOwnedMemoryDelete,
  manualHistoryMemoryDelete,
  protectedSqlRead,
  type GuardedMutationBoundary,
} from './guardedMutationBoundary';
import {
  advanceExactStepAnchor,
  proveStepAnchorTable,
  registerStepAnchorConnection,
} from './workoutStepAnchorSql';
export { protectedSqlRead } from './guardedMutationBoundary';
import type { SqlDatabase } from '@orot/storage';
import {
  attachProtectedReadEpoch,
  type ProtectedReadEpoch,
} from './protectedReadLease';
export {
  acquireIndependentReadEpoch,
  acquireProtectedReadEpoch,
  acquireWorkoutReadEpoch,
  aliasProtectedReadEpoch,
  awaitIndependentReadSettlement,
  awaitIndependentReadSettlementResult,
  hasPendingStepAnchors,
  independentReadMutation,
  protectedDatabaseOwnerIdentity,
} from './protectedReadLease';
/** Only secure production open or real SQLite test setup authorizes this gateway.
 * Any possible mutation/control that enters during a witness invalidates before dispatch. */
export function guardedNativeDatabase<T extends SqlDatabase>(
  native: T,
  deleteTrace?: GuardedMutationBoundary,
): T {
  const epoch: ProtectedReadEpoch = {
    ownerIdentity: {},
    active: 0,
    mutation: 0,
    workoutMutation: 0,
    pendingStepAnchors: 0,
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
  const track = <R>(
    call: () => R,
    trace?: GuardedMutationBoundary,
    cursorOnly = false,
  ): R => {
    // Direct execute shares the native connection with tx.execute. Either can
    // make an admitted callback dirty, and op-sqlite commits after it returns.
    if (cursorOnly) epoch.pendingStepAnchors++;
    else {
      for (const transaction of openTransactions) markDirty(transaction);
      epoch.workoutMutation++;
    }
    epoch.mutation++;
    epoch.pending++;
    const finish = () => {
      if (cursorOnly) epoch.pendingStepAnchors--;
      else epoch.workoutMutation++;
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
        key === 'executeAsync' ||
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
  attachProtectedReadEpoch(proxy, epoch);
  registerStepAnchorConnection(proxy, async (previous, next, at, current) => {
    if (!current() || epoch.detached || epoch.unsettledFailure)
      throw new Error('Step cursor owner unavailable.');
    let advanced: boolean | undefined;
    let ownerLost = false;
    let dispatched = false;
    const scope = { dirty: false };
    await track(
      async () => {
        try {
          await native.transaction(async tx => {
            // Pinned op-sqlite serializes callbacks, not direct execute calls.
            openTransactions.add(scope);
            if (epoch.pending > epoch.pendingStepAnchors) markDirty(scope);
            if (!current()) {
              ownerLost = true;
              return;
            }
            const supported = await proveStepAnchorTable(tx);
            if (!current() || epoch.detached || epoch.unsettledFailure) {
              ownerLost = true;
              return;
            }
            if (supported && !scope.dirty) {
              dispatched = true;
              advanced = await advanceExactStepAnchor(tx, previous, next, at);
            }
          });
        } catch (failure) {
          // Without an exact successful native settlement no scoped witness survives.
          if (dispatched || scope.dirty) {
            epoch.unsettledFailure = true;
            epoch.workoutMutation++;
          }
          throw failure;
        } finally {
          openTransactions.delete(scope);
          if (scope.dirty) epoch.dirtyTransactions--;
        }
      },
      undefined,
      true,
    );
    if (ownerLost || !current() || epoch.detached || epoch.unsettledFailure)
      throw new Error('Step cursor owner expired.');
    if (scope.dirty && advanced === undefined)
      throw new Error('Step cursor transaction became mixed.');
    if (advanced === false) throw new Error('The step cursor changed.');
    return advanced === true;
  });
  return proxy;
}
