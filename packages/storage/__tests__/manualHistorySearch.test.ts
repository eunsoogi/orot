import { createManualHistoryRepository } from '../src/manualHistory';
import { runMigrations } from '../src/migrations';
import type { SqlDatabase, SqlResult, SqlTransaction, SqlValue } from '../src/sql';

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

const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: DatabaseSyncConstructor };

function createDatabase(): SqlDatabase {
  const connection = new DatabaseSync(':memory:');
  const execute = async (query: string, parameters: SqlValue[] = []): Promise<SqlResult> => {
    const statement = connection.prepare(query);
    if (/^(SELECT|PRAGMA)\b/i.test(query.trim())) return { rows: statement.all(...parameters) };
    return { rows: [], rowsAffected: statement.run(...parameters).changes };
  };
  return {
    execute,
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

describe('manual history text search', () => {
  it('matches wildcard and escape characters literally', async () => {
    const database = createDatabase();
    await runMigrations(database);
    const manualHistory = createManualHistoryRepository(database);
    const literal = await manualHistory.create({
      kind: 'note',
      title: 'Synthetic rate 100% ! confirmed',
      details: 'Synthetic field_name value.',
      effectiveDate: { status: 'unknown' },
    });
    await manualHistory.create({
      kind: 'note',
      title: 'Synthetic rate 100x ? confirmed',
      details: 'Synthetic fieldXname value.',
      effectiveDate: { status: 'unknown' },
    });

    await expect(manualHistory.list({ search: '100%' })).resolves.toEqual([literal]);
    await expect(manualHistory.list({ search: 'field_name' })).resolves.toEqual([literal]);
    await expect(manualHistory.list({ search: '! confirmed' })).resolves.toEqual([literal]);
    await database.closeAsync?.();
  });
});
