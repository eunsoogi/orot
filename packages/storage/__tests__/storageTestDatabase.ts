import type { SqlDatabase, SqlExecutor, SqlResult, SqlTransaction, SqlValue } from '../src';

declare const require: (specifier: string) => unknown;

interface TestStatement {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number };
}

interface TestConnection {
  prepare(query: string): TestStatement;
  exec(query: string): void;
  close(): void;
}

interface DatabaseSyncConstructor {
  new (path: string): TestConnection;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: DatabaseSyncConstructor;
};

/** Shares a transactional SQLite adapter across storage regression tests. */
export function createDatabase(path = ':memory:'): SqlDatabase {
  const connection = new DatabaseSync(path);
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const normalized = query.trim().toUpperCase();
    const statement = connection.prepare(query);
    if (normalized.startsWith('SELECT') || /^PRAGMA [A-Z_]+$/.test(normalized)) {
      return { rows: statement.all(...parameters) };
    }
    const result = statement.run(...parameters);
    return { rows: [], rowsAffected: result.changes };
  };
  const executor: SqlExecutor = { execute };
  return {
    ...executor,
    async transaction(operation: (transaction: SqlTransaction) => Promise<void>) {
      connection.exec('BEGIN IMMEDIATE');
      const transaction: SqlTransaction = {
        execute,
        commit: () => ({ rows: [] }),
        rollback: () => ({ rows: [] }),
      };
      try {
        await operation(transaction);
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => connection.close(),
  };
}
