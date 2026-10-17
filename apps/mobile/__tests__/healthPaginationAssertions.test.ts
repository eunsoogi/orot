import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { assertHealthPagination } from '../e2e/healthPaginationAssertions';

test('the native pagination oracle preserves 1503 records, the default page size and cursor mutations in real SQLite', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    await expect(
      assertHealthPagination(createRecordRepository(database)),
    ).resolves.toEqual({
      recordCount: 1503,
      pageCount: 31,
      defaultPageSize: 50,
      secondPageValue: '85 count/min',
      tiedTimestamps: true,
      deletedCursorAndNewerArrival: true,
    });
  } finally {
    close();
  }
});

test('the oracle rejects a changed production default even if all records remain readable', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await expect(
      assertHealthPagination({
        ...repository,
        listHealthObservationPage: cursor =>
          repository.listHealthObservationPage(cursor, 4),
      }),
    ).rejects.toThrow('default size');
  } finally {
    close();
  }
});
