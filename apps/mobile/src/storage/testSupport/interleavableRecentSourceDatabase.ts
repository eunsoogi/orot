import type { SqlDatabase, SqlTransaction, SqlValue } from '@orot/storage';
import { guardedNativeDatabase } from '../protectedReadEpoch';

// Test-only structural types keep Node-only modules outside the mobile TS environment.
interface SyncDatabase {
  prepare(query: string): {
    all(...parameters: SqlValue[]): Record<string, SqlValue>[];
    run(...parameters: SqlValue[]): { changes: number | bigint };
  };
  exec(query: string): void;
  close(): void;
}

/** Synthetic SQLite, matching the native driver's separate direct execute and queued transaction paths. */
export function openInterleavableRecentSourceDatabase(
  beforeDirectExecute?: (sql: string) => Promise<void> | undefined,
) {
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SyncDatabase;
  };
  const handle = new DatabaseSync(':memory:');
  let tail = Promise.resolve();

  const execute: SqlDatabase['execute'] = async (query, parameters = []) => {
    const statement = handle.prepare(query);
    if (/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(query))
      return { rows: statement.all(...parameters) };
    return {
      rows: [],
      rowsAffected: Number(statement.run(...parameters).changes),
    };
  };
  const database = guardedNativeDatabase<SqlDatabase>({
    async execute(query, parameters) {
      await beforeDirectExecute?.(query);
      return execute(query, parameters);
    },
    transaction(operation) {
      const job = tail
        .then(() => new Promise<void>(resolve => setImmediate(resolve)))
        .then(async () => {
          handle.exec('BEGIN TRANSACTION');
          let finalized = false;
          const settle = (command: 'COMMIT' | 'ROLLBACK') => {
            handle.exec(command);
            finalized = true;
            return { rows: [] };
          };
          const tx: SqlTransaction = {
            execute,
            commit: () => settle('COMMIT'),
            rollback: () => settle('ROLLBACK'),
          };
          try {
            await operation(tx);
            if (!finalized) tx.commit();
          } catch (error) {
            if (!finalized) tx.rollback();
            throw error;
          }
        });
      tail = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  });
  return { database, close: () => handle.close() };
}
