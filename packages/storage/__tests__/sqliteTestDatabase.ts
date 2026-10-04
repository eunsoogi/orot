import type { SqlDatabase, SqlResult, SqlTransaction, SqlValue } from '../src/sql';

type Statement = {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number | bigint };
};

type SyncDatabase = {
  exec(query: string): void;
  prepare(query: string): Statement;
  close(): void;
};

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SyncDatabase;
};

export function openSqliteTestDatabase(path: string): {
  database: SqlDatabase;
  close(): void;
} {
  const handle = new DatabaseSync(path);
  let tail = Promise.resolve();

  function executeSync(query: string, parameters: SqlValue[] = []): SqlResult {
    const statement = handle.prepare(query);
    if (/^\s*(SELECT|PRAGMA)\b/i.test(query)) {
      return { rows: statement.all(...parameters) };
    }
    const result = statement.run(...parameters);
    return { rows: [], rowsAffected: Number(result.changes) };
  }

  function exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>(resolve => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await operation();
      } finally {
        release();
      }
    });
  }

  async function execute(query: string, parameters: SqlValue[] = []): Promise<SqlResult> {
    return exclusive(() => executeSync(query, parameters));
  }

  const database: SqlDatabase = {
    execute,
    async transaction(operation) {
      await exclusive(async () => {
        handle.exec('BEGIN IMMEDIATE');
        let active = true;
        const transaction: SqlTransaction = {
          execute: async (query, parameters = []) => executeSync(query, parameters),
          commit() {
            if (active) handle.exec('COMMIT');
            active = false;
            return { rows: [] };
          },
          rollback() {
            if (active) handle.exec('ROLLBACK');
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
      });
    },
  };

  return { database, close: () => handle.close() };
}
