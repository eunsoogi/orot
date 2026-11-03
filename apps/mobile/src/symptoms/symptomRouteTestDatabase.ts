import { createSymptomRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase, SqlResult, SqlValue } from '@orot/storage';
import { createSymptomJournalRepository } from './localRepository';

const { DatabaseSync } = require('node:sqlite');

/** Real SQLite transactions exercise the production writer; only the native database port is replaced. */
export async function symptomRouteDatabase() {
  const connection = new DatabaseSync(':memory:');
  let rejectWrite = false;
  const execute = async (
    query: string,
    values: SqlValue[] = [],
  ): Promise<SqlResult> => {
    const statement = connection.prepare(query);
    if (/^(SELECT|PRAGMA)/i.test(query.trim()))
      return { rows: statement.all(...values) };
    return { rows: [], rowsAffected: statement.run(...values).changes };
  };
  const database: SqlDatabase = {
    execute,
    async transaction(operation) {
      connection.exec('BEGIN IMMEDIATE');
      try {
        await operation({
          execute,
          commit: () => ({ rows: [] }),
          rollback: () => ({ rows: [] }),
        });
        if (rejectWrite) {
          rejectWrite = false;
          throw new Error('Synthetic transaction failure');
        }
        connection.exec('COMMIT');
      } catch (error) {
        connection.exec('ROLLBACK');
        throw error;
      }
    },
    closeAsync: async () => connection.close(),
  };
  await runMigrations(database);
  let nextId = 0;
  const storage = createSymptomRepository(
    database,
    () => '2026-11-03T10:00:00.000Z',
  );
  const journal = createSymptomJournalRepository(storage, {
    now: () => '2026-11-03T10:00:00.000Z',
    createId: () => `synthetic-${++nextId}`,
  });
  return {
    journal,
    storage,
    failNextWrite: () => {
      rejectWrite = true;
    },
    close: () => connection.close(),
  };
}
