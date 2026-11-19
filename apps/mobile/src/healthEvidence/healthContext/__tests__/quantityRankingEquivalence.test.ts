import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

/** Restore the prior two rankings independently of the packed earliest key. */
function twoRankingQuery(query: string) {
  return query
    .replace('dated AS (', 'dated AS MATERIALIZED (')
    .replace(
      ') AS newest FROM dated d',
      `) AS newest, row_number() OVER (
          PARTITION BY d.date, d.concept, d.unit, d.sensor ORDER BY d.at_key ASC, d.id
        ) AS oldest FROM dated d`,
    )
    .replace(
      `min(at_key || hex(id) || '"' || at) AS first_row`,
      'min(CASE WHEN oldest = 1 THEN at END) AS first_at',
    )
    .replace(
      `substr(d.first_row, instr(d.first_row, '"') + 1) AS first_at`,
      'd.first_at',
    );
}

/** Source timestamps can differ at the same instant. Test both tie directions,
 * prefix and Unicode IDs, and the aggregation order used by retained revisions. */
test('quantity aggregation avoids the second time sort without changing any ordered output', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const repository = createRecordRepository(f.database);
    const samples = [
      ['a!', '2026-03-08T05:01:00Z', 14],
      ['a', '2026-03-08T00:01:00.0000-05:00', 13],
      ['é', '2026-03-08T05:01:00.000Z', 21],
      ['older-middle', '2026-03-08T05:02:00Z', 1e21],
      ['middle', '2026-03-08T05:03:00Z', 0.25],
      ['later-middle', '2026-03-08T05:04:00Z', -1e21],
      ['newer!', '2026-03-08T07:30:00Z', 17],
      ['newer', '2026-03-08T03:30:00.000-04:00', 19],
    ] as const;
    for (const [id, at, amount] of samples) {
      const record = healthObservation(id, 'heart_rate', at);
      await repository.put('health_observation', {
        ...record,
        value: { kind: 'quantity', amount, unit: 'count/min' },
      });
    }
    const days = healthContextDays({
      fromInclusive: '2026-03-08T00:00:00-05:00',
      toExclusive: '2026-03-09T00:00:00-04:00',
      timeZone: 'America/New_York',
    });
    const result = await readHealthQuantityContext(
      {
        async execute(query, parameters) {
          const prior = twoRankingQuery(query);
          expect(prior).toContain('AS oldest');
          const [actual, expected] = await Promise.all([
            f.database.execute(query, parameters),
            f.database.execute(prior, parameters),
          ]);
          expect(actual).toEqual(expected);
          const sorters = async (sql: string) =>
            (
              await f.database.execute('EXPLAIN ' + sql, parameters)
            ).rows.filter(row => row.opcode === 'SorterOpen').length;
          expect(await sorters(query)).toBeLessThan(await sorters(prior));
          return actual;
        },
      },
      days,
      undefined,
      'measurements',
      '2027-01-01T00:00:00Z',
    );
    expect(result.series[0]?.days[0]).toMatchObject({
      samples: samples.length,
      firstAt: samples[1][1],
      lastAt: samples[7][1],
      latest: samples[7][2],
    });
  } finally {
    f.close();
  }
});
