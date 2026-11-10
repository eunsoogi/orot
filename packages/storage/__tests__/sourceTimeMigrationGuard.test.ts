import { openEncryptedStorage, runMigrations } from '../src';
import type { SqlDatabase, SqlTransaction } from '../src';
import { createDatabase, options } from './sourceEvidenceTestSupport';

test.each([12, 13, 14])(
  'rejects missing source timestamp metadata without advancing version %i',
  async (version) => {
    const database = createDatabase();
    await openEncryptedStorage(options(database));
    await database.execute('INSERT INTO daily_report_heads VALUES (?, ?, ?, ?)', [
      'synthetic-day',
      'run',
      1,
      0,
    ]);
    await database.execute(`PRAGMA user_version = ${version}`);
    const unavailableSchema: SqlDatabase = {
      ...database,
      transaction(operation) {
        return database.transaction((transaction) => {
          const wrapped: SqlTransaction = {
            ...transaction,
            execute(query, parameters) {
              if (query === 'PRAGMA table_info(source_records)')
                return Promise.resolve({ rows: [] });
              return transaction.execute(query, parameters);
            },
          };
          return operation(wrapped);
        });
      },
    };
    try {
      await expect(runMigrations(unavailableSchema)).rejects.toThrow(
        'Source timestamp schema is unavailable.',
      );
      expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(version);
      expect((await database.execute('SELECT identity_key FROM daily_report_heads')).rows).toEqual([
        { identity_key: 'synthetic-day' },
      ]);
    } finally {
      await database.closeAsync?.();
    }
  },
);
