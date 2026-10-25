import type {
  SqlDatabase,
  SqlResult,
  SqlTransaction,
  SqlValue,
} from '@orot/storage';

interface TestStatement {
  all(...parameters: SqlValue[]): Array<Record<string, SqlValue>>;
  run(...parameters: SqlValue[]): { changes: number | bigint };
}

interface TestConnection {
  exec(query: string): void;
  prepare(query: string): TestStatement;
  close(): void;
}

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => TestConnection;
};

/** Uses real SQLite so lifecycle tests exercise the same public database contract as the app. */
export function createHealthEvidenceTestDatabase(): {
  readonly database: SqlDatabase;
  close(): void;
} {
  const connection = new DatabaseSync(':memory:');
  const executeSync = (
    query: string,
    parameters: SqlValue[] = [],
  ): SqlResult => {
    const statement = connection.prepare(query);
    if (/^\s*(SELECT|PRAGMA)\b/i.test(query)) {
      return { rows: statement.all(...parameters) };
    }
    return {
      rows: [],
      rowsAffected: Number(statement.run(...parameters).changes),
    };
  };
  const database: SqlDatabase = {
    execute: async (query, parameters = []) => executeSync(query, parameters),
    async transaction(operation) {
      connection.exec('BEGIN IMMEDIATE');
      let active = true;
      const transaction: SqlTransaction = {
        execute: async (query, parameters = []) =>
          executeSync(query, parameters),
        commit() {
          if (active) connection.exec('COMMIT');
          active = false;
          return { rows: [] };
        },
        rollback() {
          if (active) connection.exec('ROLLBACK');
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
    },
  };
  return { database, close: () => connection.close() };
}
