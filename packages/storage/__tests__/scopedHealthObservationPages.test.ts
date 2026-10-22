import { createRecordRepository, runMigrations } from '../src';
import { readHealthObservationPage } from '../src/healthObservationPages';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { healthObservation } from './localQueryTestSupport';
import { HEALTH_OBSERVATION_PAGE_CATEGORIES } from '../src/healthObservationPageFilter';

function observed(...args: Parameters<typeof healthObservation>) {
  return { ...healthObservation(...args), ingestedAt: '2026-10-22T00:00:00Z' };
}

test('every health category reads its own bounded history without consuming unrelated pages', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const concepts = [
      'blood pressure systolic',
      'heart_rate',
      'step_count',
      'body_mass',
      'HKCategoryTypeIdentifierSleepAnalysis',
      'respiratory_rate',
    ];
    for (const [index, concept] of concepts.entries()) {
      for (let row = 0; row < 3; row += 1) {
        await repository.put(
          'health_observation',
          observed(`${index}-${row}`, concept, `2026-10-${18 + row}T00:00:00Z`),
        );
      }
    }
    for (const [index, category] of HEALTH_OBSERVATION_PAGE_CATEGORIES.entries()) {
      const filter = {
        category,
        fromInclusive: '2026-10-19T00:00:00Z',
        toInclusive: '2026-10-21T00:00:00Z',
      };
      const first = await repository.listHealthObservationPage(null, 1, filter);
      expect(first.records.map((record) => record.id)).toEqual([`${index}-2`]);
      const second = await repository.listHealthObservationPage(first.nextCursor, 1, filter);
      expect(second.records.map((record) => record.id)).toEqual([`${index}-1`]);
      expect(second.nextCursor).toBeNull();
    }
  } finally {
    close();
  }
});

test('reads a month of daily pressure directly despite twenty thousand newer Watch rows', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const seededAt = Date.now();
    await database.execute(
      `WITH RECURSIVE samples(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM samples WHERE n < 19999)
       INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json)
       SELECT 'watch-' || n, '2026-10-20T20:00:00Z', '2026-10-20T20:00:00Z', '2026-10-22T00:00:00Z',
              json_set(?, '$.id', 'watch-' || n) FROM samples`,
      [JSON.stringify(observed('watch-template', 'heart_rate', '2026-10-20T20:00:00Z'))],
    );
    await repository.transaction(async (writer) => {
      for (let day = 0; day < 30; day += 1) {
        const at = new Date(Date.parse('2026-10-20T09:00:00Z') - day * 86400000).toISOString();
        for (const component of ['systolic', 'diastolic']) {
          await writer.put(
            'health_observation',
            observed(`pressure-${day}-${component}`, `blood pressure ${component}`, at),
          );
        }
      }
      await writer.put(
        'health_observation',
        observed('old-pressure', 'blood pressure systolic', '2020-01-01T00:00:00Z'),
      );
      await writer.put(
        'health_observation',
        observed('future-pressure', 'blood pressure systolic', '2026-10-21T00:00:00Z'),
      );
    });
    const seedMs = Date.now() - seededAt;
    let statement = '';
    let parameters: Parameters<typeof database.execute>[1];
    const queriedAt = Date.now();
    const page = await readHealthObservationPage(
      {
        execute: async (sql, values) => {
          statement = sql;
          parameters = values;
          return database.execute(sql, values);
        },
      },
      null,
      100,
      {
        category: 'blood_pressure',
        fromInclusive: '2026-09-21T00:00:00Z',
        toInclusive: '2026-10-20T23:59:59Z',
      },
    );
    const queryMs = Date.now() - queriedAt;
    expect(page.records).toHaveLength(60);
    expect(page.nextCursor).toBeNull();
    expect(new Set(page.records.map((record) => record.effectiveAt))).toHaveProperty('size', 30);
    expect(page.records.every((record) => record.concept.startsWith('blood pressure '))).toBe(true);
    const plan = await database.execute('EXPLAIN QUERY PLAN ' + statement, parameters);
    expect(plan.rows.map((row) => row.detail).join(' ')).toContain(
      'health_observations_library_idx',
    );
    expect(plan.rows.map((row) => row.detail).join(' ')).not.toContain('USE TEMP B-TREE');
    console.info('synthetic-scoped-health-page', {
      unrelatedRows: 20000,
      returnedRows: page.records.length,
      seedMs,
      queryMs,
    });
  } finally {
    close();
  }
});

test('scoped pages preserve exact source instant order, tied IDs and user-reported records', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const [id, at] of [
      ['a', '2026-10-20T09:00:00.0002+09:00'],
      ['b', '2026-10-20T00:00:00.0002Z'],
      ['c', '2026-10-20T00:00:00.0001Z'],
    ])
      await repository.put(
        'health_observation',
        observed(id!, 'blood pressure systolic', at!, 'manual', 'user_reported'),
      );
    const filter = { category: 'blood_pressure' as const, toInclusive: '2026-10-21T00:00:00Z' };
    const first = await repository.listHealthObservationPage(null, 2, filter);
    expect(first.records.map((record) => record.id)).toEqual(['a', 'b']);
    const second = await repository.listHealthObservationPage(first.nextCursor, 2, filter);
    expect(second.records.map((record) => record.id)).toEqual(['c']);
    expect(second.nextCursor).toBeNull();
    await expect(
      repository.listHealthObservationPage(null, 2, { ...filter, category: 'invalid' as never }),
    ).rejects.toThrow();
  } finally {
    close();
  }
});

test('upgrades version nine by adding only the library index and preserving saved rows', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.put(
      'health_observation',
      observed('saved-pressure', 'blood pressure systolic', '2026-10-20T00:00:00Z'),
    );
    await database.execute('DROP INDEX health_observations_library_idx');
    await database.execute('PRAGMA user_version = 9');
    const statements: string[] = [];
    await runMigrations({
      ...database,
      transaction: (operation) =>
        database.transaction((transaction) =>
          operation({
            ...transaction,
            execute: (sql, values) => {
              statements.push(sql);
              return transaction.execute(sql, values);
            },
          }),
        ),
    });
    expect(statements.some((sql) => /DROP|INSERT|UPDATE|ALTER/i.test(sql))).toBe(false);
    expect((await database.execute('PRAGMA user_version')).rows[0]!.user_version).toBe(10);
    const page = await repository.listHealthObservationPage(null, 100, {
      category: 'blood_pressure',
      toInclusive: '2026-10-21T00:00:00Z',
    });
    expect(page.records.map((record) => record.id)).toEqual(['saved-pressure']);
  } finally {
    close();
  }
});
