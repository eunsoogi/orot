import type { SqlDatabase, SqlResult, SqlTransaction, SqlValue } from '../src';

type Statement = {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number | bigint };
};
type Handle = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Handle };

/** Models op-sqlite transaction completion for migration tests, using unencrypted Node SQLite. */
export function openMigrationSqlite(path: string) {
  const handle = new DatabaseSync(path);
  let tail = Promise.resolve();
  function executeSync(query: string, parameters: SqlValue[] = []): SqlResult {
    const statement = handle.prepare(query);
    if (/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(query)) return { rows: statement.all(...parameters) };
    return { rows: [], rowsAffected: Number(statement.run(...parameters).changes) };
  }
  const database: SqlDatabase = {
    async execute(query, parameters) {
      return executeSync(query, parameters);
    },
    async transaction(operation) {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        handle.exec('BEGIN TRANSACTION');
        let active = true;
        const requireActive = () => {
          if (!active) throw new Error('Cannot execute query on finalized transaction');
        };
        const transaction: SqlTransaction = {
          async execute(query, parameters) {
            requireActive();
            return executeSync(query, parameters);
          },
          commit() {
            requireActive();
            handle.exec('COMMIT');
            active = false;
            return { rows: [] };
          },
          rollback() {
            requireActive();
            handle.exec('ROLLBACK');
            active = false;
            return { rows: [] };
          },
        };
        try {
          await operation(transaction);
          if (active) transaction.commit();
        } catch (error) {
          if (active) transaction.rollback();
          throw error;
        }
      } finally {
        release();
      }
    },
  };
  return {
    database: { ...database, closeAsync: async () => handle.close() },
    close: () => handle.close(),
  };
}
