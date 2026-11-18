import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';
import { calendarSweepQuery } from '../testSupport/calendarSweepQuery';

/** Real SQLite verifies exact floating-point results and indexed range seeks.
 * Query-plan assertions avoid noisy wall-clock speed requirements in CI. */
test('dense and sparse calendars preserve all samples without the calendar sort', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const records = Array.from({ length: 10000 }, (_, i) => {
      const at = new Date(
        Date.UTC(2023, 0, 1) + Math.floor(i / 2) * 60000,
      ).toISOString();
      return {
        ...healthObservation(`scale-${i}`, 'heart_rate', at),
        value: {
          kind: 'quantity',
          amount: i % 3 ? 0.1 : 100000.0000001,
          unit: 'bpm',
        },
      };
    });
    await f.database.execute(
      `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
      SELECT json_extract(value,'$.id'), json_extract(value,'$.effectiveAt'), json_extract(value,'$.effectiveAt'),
        json_extract(value,'$.ingestedAt'), value FROM json_each(?)`,
      [JSON.stringify(records)],
    );
    for (const [fromInclusive, toExclusive, expectedCount] of [
      ['2023-01-01T00:00:00Z', '2023-01-05T00:00:00Z', 10000],
      ['2022-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 10000],
      ['2010-01-01T00:00:00Z', '2022-01-01T00:00:00Z', 0],
    ] as const) {
      const days = healthContextDays({
        fromInclusive,
        toExclusive,
        timeZone: 'UTC',
      });
      const result = await readHealthQuantityContext(
        {
          execute: async (q, p) => {
            const legacy = calendarSweepQuery(q);
            const rows = await f.database.execute(q, p);
            expect(rows).toEqual(await f.database.execute(legacy, p));
            const plan = await f.database.execute('EXPLAIN QUERY PLAN ' + q, p);
            const oldPlan = await f.database.execute(
              'EXPLAIN QUERY PLAN ' + legacy,
              p,
            );
            const details = plan.rows.map(r => String(r.detail));
            expect(
              details.some(d =>
                /SEARCH r USING (?:COVERING )?INDEX health_context_observation_(?:time|covering)/.test(
                  d,
                ),
              ),
            ).toBe(true);
            expect(details.some(d => d === 'SCAN r')).toBe(false);
            const sorts = (rs: typeof plan.rows) =>
              rs.filter(r =>
                String(r.detail).includes('TEMP B-TREE FOR ORDER BY'),
              ).length;
            expect(sorts(plan.rows)).toBeLessThan(sorts(oldPlan.rows));
            return rows;
          },
        },
        days,
      );
      expect(
        result.series.flatMap(s => s.days).reduce((n, d) => n + d.samples, 0),
      ).toBe(expectedCount);
    }
  } finally {
    f.close();
  }
}, 30000);
