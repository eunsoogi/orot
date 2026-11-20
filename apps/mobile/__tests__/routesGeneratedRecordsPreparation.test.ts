import { routesGeneratedRecordsEnabled } from '../e2e/routesGeneratedRecordsSelection';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../packages/storage/__tests__/sqliteTestDatabase';
import { prepareRoutesGeneratedRecords } from '../e2e/routesGeneratedRecordsPreparation';

const settings = {
  OROT_TEST_SCENARIO: 'ai-feature-visit-questions',
  OROT_ROUTES_GENERATED_RECORDS: 'synthetic',
  OROT_ROUTES_FIXTURE_SESSION: '11111111-2222-4333-8444-555555555555',
};

test.each([
  {},
  { ...settings, OROT_TEST_SCENARIO: 'evidence-visual' },
  { ...settings, OROT_ROUTES_GENERATED_RECORDS: 'YES' },
  { ...settings, OROT_ROUTES_FIXTURE_SESSION: 'unowned' },
])('unrelated or unowned launch never opens storage: %j', async candidate => {
  const open = jest.fn();
  const seed = jest.fn();
  await expect(
    prepareRoutesGeneratedRecords(candidate, {
      nativeTestControl: true,
      open,
      seed,
    }),
  ).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  expect(seed).not.toHaveBeenCalled();
});

test('native test boundary is required even with matching flags', async () => {
  const open = jest.fn();
  await expect(
    prepareRoutesGeneratedRecords(settings, {
      nativeTestControl: false,
      open,
      seed: jest.fn(),
    }),
  ).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
  expect(routesGeneratedRecordsEnabled(settings)).toBe(true);
});

test('actual fresh SQLite admits seed only after checks, rejects prior unrelated records, and propagates failure', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const records = createRecordRepository(f.database);
    const open = async () => ({ database: f.database, records });
    let release!: () => void;
    const seed = jest.fn(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    let ready = false;
    const preparation = prepareRoutesGeneratedRecords(settings, {
      nativeTestControl: true,
      open,
      seed,
    }).then(() => {
      ready = true;
    });
    while (!seed.mock.calls.length)
      await new Promise<void>(resolve => setImmediate(resolve));
    expect(ready).toBe(false);
    release();
    await preparation;
    expect(ready).toBe(true);
    expect(seed).toHaveBeenCalledWith(f.database, records);
    await expect(
      prepareRoutesGeneratedRecords(settings, {
        nativeTestControl: true,
        open,
        seed: async () => {
          throw new Error('commit failed');
        },
      }),
    ).rejects.toThrow('commit failed');
    await f.database.execute('CREATE TABLE conversation_artifacts (id TEXT)');
    await f.database.execute(
      "INSERT INTO conversation_artifacts VALUES ('unrelated-retained-row')",
    );
    seed.mockClear();
    await expect(
      prepareRoutesGeneratedRecords(settings, {
        nativeTestControl: true,
        open,
        seed,
      }),
    ).rejects.toThrow('empty owned');
    expect(seed).not.toHaveBeenCalled();
    expect(
      (await f.database.execute('SELECT id FROM conversation_artifacts')).rows,
    ).toEqual([{ id: 'unrelated-retained-row' }]);
  } finally {
    f.close();
  }
});
