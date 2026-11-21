import type { SqlDatabase } from '@orot/storage';

type Epoch = {
  active: number;
  mutation: number;
  pending: number;
  dirtyTransactions: number;
  unsettledFailure?: boolean;
  detached?: boolean;
};
const epochs = new WeakMap<SqlDatabase, Epoch>();

export function protectedSqlRead(query: string): boolean {
  if (/^PRAGMA (?:schema_version|data_version|compile_options)$/i.test(query))
    return true;
  return (
    /^[\t \r\n]*SELECT\b/i.test(query) &&
    !query.includes(';') &&
    !/\b(?:load_extension|writefile|eval)\s*\(/i.test(query)
  );
}

/** Only secure production open or real SQLite test setup authorizes this gateway.
 * Any possible mutation/control that enters during a witness invalidates before dispatch. */
export function guardedNativeDatabase<T extends SqlDatabase>(native: T): T {
  const epoch: Epoch = {
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
  const track = <R>(call: () => R): R => {
    // Direct execute shares the native connection with tx.execute. Either can
    // make an admitted callback dirty, and op-sqlite commits after it returns.
    for (const transaction of openTransactions) markDirty(transaction);
    epoch.mutation++;
    epoch.pending++;
    const finish = () => {
      epoch.pending--;
      epoch.mutation++;
    };
    try {
      const result = call();
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
        // The native BEGIN is synchronous; a tracked asynchronous direct
        // dispatch may still be queued and execute inside this transaction.
        if (epoch.pending !== 0) markDirty(scope);
        try {
          await operation({
            execute(sql, binds) {
              return query(sql, () => tx.execute(sql, binds));
            },
            commit: () => track(() => tx.commit()),
            rollback: () => track(() => tx.rollback()),
          });
        } catch (error) {
          callbackFailure = { error };
          throw error;
        }
      });
    } catch (error) {
      // The pinned driver rethrows the callback error after successful automatic
      // rollback. A different settlement failure gives no proof of autocommit.
      if (scope.dirty && (!callbackFailure || callbackFailure.error !== error))
        epoch.unsettledFailure = true;
      throw error;
    } finally {
      // Keep the dirty interval through native automatic COMMIT/ROLLBACK,
      // not merely until the JavaScript mutation statement settles.
      openTransactions.delete(scope);
      if (scope.dirty) epoch.dirtyTransactions--;
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
  return {
    current: () =>
      active &&
      !epoch.detached &&
      start === epoch.mutation &&
      (!independent ||
        (epoch.dirtyTransactions === 0 && !epoch.unsettledFailure)),
    dispose() {
      if (active) epoch.active--;
      active = false;
    },
  };
}
