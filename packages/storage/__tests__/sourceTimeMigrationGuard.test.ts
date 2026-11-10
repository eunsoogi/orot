import { openEncryptedStorage, runMigrations } from '../src';
import type { SqlDatabase, SqlTransaction } from '../src';
import { createDatabase, options } from './sourceEvidenceTestSupport';

test('rejects missing source timestamp metadata without advancing the schema version', async () => {
  const database = createDatabase();
  await openEncryptedStorage(options(database));
  await database.execute('PRAGMA user_version = 12');
  const unavailableSchema: SqlDatabase = {
    ...database,
    transaction(operation) {
      return database.transaction((transaction) => {
        const wrapped: SqlTransaction = {
          ...transaction,
          execute(query, parameters) {
            if (query === 'PRAGMA table_info(source_records)') return Promise.resolve({ rows: [] });
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
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(12);
  } finally {
    await database.closeAsync?.();
  }
});
