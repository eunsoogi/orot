import type { SqlDatabase } from '@orot/storage';

let nextOperation = 0;
const finishers = new WeakMap<SqlDatabase, (success: boolean) => void>();

export function finishOverviewSnapshot(
  database: SqlDatabase,
  success: boolean,
) {
  finishers.get(database)?.(success);
}

/** Wraps only the Overview snapshot; the driver still owns admission and rollback. */
export function observeOverviewSnapshot(
  database: SqlDatabase,
  event: (name: string) => void,
  failRead: boolean,
): SqlDatabase {
  const id = ++nextOperation;
  event(`overview-read-requested:${id}`);
  const observed: SqlDatabase = {
    async execute(query, bindings) {
      event(`overview-direct-requested:${id}`);
      try {
        return await database.execute(query, bindings);
      } finally {
        event(`overview-direct-settled:${id}`);
      }
    },
    async transaction(operation) {
      event(`overview-requested:${id}`);
      try {
        await database.transaction(tx => {
          event(`overview-admitted:${id}`);
          if (failRead) {
            event(`overview-injected-failure:${id}`);
            throw new Error('Synthetic overview read failure.');
          }
          return operation(tx);
        });
        event(`overview-settled-ok:${id}`);
      } catch (error) {
        event(`overview-settled-failed:${id}`);
        throw error;
      }
    },
  };
  finishers.set(observed, success =>
    event(`overview-load-${success ? 'ok' : 'failed'}:${id}`),
  );
  return observed;
}
