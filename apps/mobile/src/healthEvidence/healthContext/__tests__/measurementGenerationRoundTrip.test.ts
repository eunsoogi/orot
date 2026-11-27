import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openOpSqliteFileQueue } from '../../../../test-support/opSqliteFileQueueFixture';
import { ensureHealthContextGeneration } from '../generation';
import { createHealthContextReader, readHealthContextReport } from '../reader';
import type { HealthContextReport } from '../types';

const window = {
  fromInclusive: '2026-01-01T00:00:00Z',
  toExclusive: '2026-01-10T00:00:00Z',
  timeZone: 'UTC',
};

const generation =
  'SELECT mutations, deletions FROM health_context_generation WHERE singleton = 1';
const changeAt = {
  'during-aggregation': 1,
  'after-report-probe': 2,
  'after-last-transaction-probe': 3,
} as const;
type Boundary = keyof typeof changeAt;

async function setup(boundary?: Boundary) {
  const fixture = openOpSqliteFileQueue();
  await runMigrations(fixture.database);
  await ensureHealthContextGeneration(fixture.database);
  const records = createRecordRepository(fixture.database);
  await records.put(
    'health_observation',
    healthObservation(
      'generated-heart-rate',
      'heart_rate',
      '2026-01-04T12:00:00Z',
    ),
  );
  const checks: string[] = [];
  let trip = 0;
  let changed = false;
  const database: SqlDatabase = {
    ...fixture.database,
    execute(sql, params) {
      if (sql === generation) checks.push('outer');
      return fixture.database.execute(sql, params);
    },
    transaction: run =>
      fixture.database.transaction(tx =>
        run({
          ...tx,
          async execute(sql, params) {
            const result = await tx.execute(sql, params);
            if (sql === generation) {
              checks.push('transaction');
              trip += 1;
              if (boundary && !changed && trip === changeAt[boundary]) {
                changed = true;
                await tx.execute(
                  'UPDATE health_context_generation SET mutations = mutations + 1, deletions = deletions + 1 WHERE singleton = 1',
                );
              }
            }
            return result;
          },
        }),
      ),
  };
  return { fixture, database, checks };
}

test('ordinary heart-rate report skips only the cold cache probe and retains generation checks in and after the transaction', async () => {
  const { fixture, database, checks } = await setup();
  try {
    let expected: HealthContextReport | undefined;
    await fixture.database.transaction(async tx => {
      expected = await readHealthContextReport(tx, window, ['measurements']);
    });
    expect(expected?.quantities[0]?.concept).toBe('heart_rate');
    const read = createHealthContextReader(database);
    expect(await read(window, ['measurements'])).toEqual(expected);
    expect(checks).toEqual([
      'transaction',
      'transaction',
      'transaction',
      'outer',
    ]);
    checks.length = 0;
    expect(await read(window, ['measurements'])).toEqual(expected);
    expect(checks).toEqual(['outer']);
  } finally {
    await fixture.close();
  }
});

test.each([
  ['during-aggregation', 'Health context changed during aggregation.'],
  ['after-report-probe', 'Health context changed during aggregation.'],
  [
    'after-last-transaction-probe',
    'Health context changed before publication.',
  ],
] as const)(
  'a generation change %s rejects the old report',
  async (boundary, message) => {
    const { fixture, database } = await setup(boundary);
    try {
      const read = createHealthContextReader(database);
      await expect(read(window, ['measurements'])).rejects.toThrow(message);
      // A successful subsequent request did not receive a stale cache entry.
      const successor = await read(window, ['measurements']);
      expect(successor.quantities[0]?.concept).toBe('heart_rate');
      expect(successor.deletionGeneration).toBe(1);
    } finally {
      await fixture.close();
    }
  },
);
