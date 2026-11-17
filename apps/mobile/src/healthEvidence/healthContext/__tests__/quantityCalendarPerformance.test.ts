import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

// Synthetic SQLite benchmark: identical samples, increasing calendar width.
// Assert the query-plan structure and full result, not host-dependent wall-clock speed.
test('aggregates synthetic long-history samples without dropping data', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    await database.transaction(async tx => {
      for (let index = 0; index < 10000; index += 1) {
        const at = new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString();
        const record = healthObservation(
          `synthetic-${index}`,
          'heart_rate',
          at,
        );
        await tx.execute(
          'INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
          [record.id, at, at, record.ingestedAt, JSON.stringify(record)],
        );
      }
    });
    for (const years of [1, 4]) {
      const days = healthContextDays({
        fromInclusive: `${2027 - years}-01-01T00:00:00Z`,
        toExclusive: '2027-01-01T00:00:00Z',
        timeZone: 'UTC',
      });
      const result = await readHealthQuantityContext(
        {
          execute: async (query, parameters) => {
            const plan = await database.execute(
              `EXPLAIN QUERY PLAN ${query}`,
              parameters,
            );
            const calendarScans = plan.rows.filter(row =>
              String(row.detail).includes('SCAN json_each'),
            );
            expect(calendarScans).toHaveLength(1);
            for (const scan of calendarScans) {
              let ancestor = scan;
              while (Number(ancestor.parent)) {
                ancestor = plan.rows.find(row => row.id === ancestor.parent)!;
                expect(String(ancestor.detail)).not.toContain('CORRELATED');
              }
            }
            return database.execute(query, parameters);
          },
        },
        days,
      );
      expect(
        result.series
          .flatMap(series => series.days)
          .reduce((n, day) => n + day.samples, 0),
      ).toBe(10000);
    }
  } finally {
    close();
  }
}, 120000);
