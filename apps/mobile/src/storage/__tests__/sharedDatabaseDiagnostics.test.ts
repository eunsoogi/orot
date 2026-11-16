import { NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import { observeSharedDatabase } from '../sharedDatabaseDiagnostics';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';

beforeEach(() => {
  NativeModules.OrotProviderDiagnostics = { enabled: true, report: jest.fn() };
});

function reports() {
  return NativeModules.OrotProviderDiagnostics.report as jest.Mock;
}

test('disabled diagnostics return the original connection and preserve all native capabilities', () => {
  const database = {
    execute: jest.fn(),
    transaction: jest.fn(),
    close: jest.fn(),
  };
  NativeModules.OrotProviderDiagnostics.enabled = false;
  expect(observeSharedDatabase(database)).toBe(database);
  expect(reports()).not.toHaveBeenCalled();
});

test.each([
  ['CREATE TABLE synthetic_private (value TEXT)', 'sql_schema'],
  [
    'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1',
    'sql_generation',
  ],
  [
    'SELECT * FROM (WITH days(date) AS (VALUES (?)) SELECT * FROM days)',
    'sql_aggregate',
  ],
  ['SELECT vector_blob FROM rag_embeddings WHERE chunk_id = ?', 'sql_vector'],
  [
    'SELECT payload_json FROM health_observations WHERE id = ?',
    'sql_health_records',
  ],
  [
    'SELECT result_json FROM conversation_artifacts WHERE id = ?',
    'sql_artifact',
  ],
  ['SELECT secret_value FROM synthetic_private WHERE id = ?', 'sql_other'],
])('emits only a fixed category for %s', async (query, stage) => {
  const result = { rows: [{ private: 'synthetic-private-result' }] };
  const database: SqlDatabase = {
    execute: jest.fn(async () => result),
    transaction: jest.fn(),
  };
  const values = ['synthetic-private-binding'];
  expect(await observeSharedDatabase(database).execute(query, values)).toBe(
    result,
  );
  expect(database.execute).toHaveBeenCalledWith(query, values);
  expect(reports().mock.calls).toEqual([
    ['storage', stage, 'started'],
    ['storage', stage, 'completed'],
  ]);
});

test('preserves real commit, rollback and errors without double-reporting transaction SQL', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    const db = observeSharedDatabase(f.database);
    await db.execute('CREATE TABLE synthetic_private (value INTEGER)');
    reports().mockClear();
    await db.transaction(async tx => {
      await tx.execute('INSERT INTO synthetic_private VALUES (?)', [1]);
    });
    expect(reports().mock.calls).toEqual([
      ['storage', 'database_transaction_wait', 'started'],
      ['storage', 'database_transaction_wait', 'completed'],
      ['storage', 'database_transaction', 'started'],
      ['storage', 'sql_other', 'started'],
      ['storage', 'sql_other', 'completed'],
      ['storage', 'database_transaction', 'completed'],
    ]);
    const error = new Error('synthetic-private-error');
    reports().mockImplementation(() => {
      throw new Error('sink unavailable');
    });
    await expect(
      db.transaction(async tx => {
        await tx.execute('INSERT INTO synthetic_private VALUES (?)', [2]);
        throw error;
      }),
    ).rejects.toBe(error);
    expect(
      (await db.execute('SELECT value FROM synthetic_private')).rows,
    ).toEqual([{ value: 1 }]);
  } finally {
    f.close();
  }
});

test('distinguishes waiting for admission from callback ownership', async () => {
  let admit!: () => void;
  const database: SqlDatabase = {
    execute: jest.fn(),
    transaction: op =>
      new Promise<void>(resolve => {
        admit = () => {
          op({
            execute: jest.fn(),
            commit: jest.fn(),
            rollback: jest.fn(),
          }).then(resolve);
        };
      }),
  };
  const pending = observeSharedDatabase(database).transaction(async () => {});
  expect(reports().mock.calls).toEqual([
    ['storage', 'database_transaction_wait', 'started'],
  ]);
  admit();
  await pending;
  expect(reports().mock.calls.slice(1)).toEqual([
    ['storage', 'database_transaction_wait', 'completed'],
    ['storage', 'database_transaction', 'started'],
    ['storage', 'database_transaction', 'completed'],
  ]);
});

test('unobserved native methods retain their original owning object', () => {
  const database = {
    execute: jest.fn(),
    transaction: jest.fn(),
    nativeOwner() {
      return this;
    },
  };
  expect(observeSharedDatabase(database).nativeOwner()).toBe(database);
});

test('reports admission failure without inventing callback ownership', async () => {
  const failure = new Error('synthetic connection detail');
  const database: SqlDatabase = {
    execute: jest.fn(),
    transaction: jest.fn(async () => {
      throw failure;
    }),
  };
  await expect(
    observeSharedDatabase(database).transaction(async () => {}),
  ).rejects.toBe(failure);
  expect(reports().mock.calls).toEqual([
    ['storage', 'database_transaction_wait', 'started'],
    ['storage', 'database_transaction_wait', 'failed'],
  ]);
});

test('reports SQL failure without exposing the original error and rethrows it unchanged', async () => {
  const failure = new Error('synthetic private database failure');
  const database: SqlDatabase = {
    execute: jest.fn(async () => {
      throw failure;
    }),
    transaction: jest.fn(),
  };
  await expect(
    observeSharedDatabase(database).execute('SELECT ?', ['private']),
  ).rejects.toBe(failure);
  expect(reports().mock.calls).toEqual([
    ['storage', 'sql_other', 'started'],
    ['storage', 'sql_other', 'failed'],
  ]);
});
