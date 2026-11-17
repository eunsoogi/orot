import {
  runMigrations,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { ensureHealthContextGeneration } from '../generation';
import { readHealthQuantityContext } from '../quantityQuery';
import { addHeartRateActivityContext } from '../heartRateActivity';
import { readHealthSleepContext } from '../sleepQuery';
import { readAvailableHealthContextWindow } from '../availableWindow';
import { healthContextDays } from '../window';

const { writeFileSync } = require('node:fs') as {
  writeFileSync(path: string, value: string): void;
};

/** Synthetic SQL-only profile. Calendar width changes without changing admitted samples;
 * distinct scopes deliberately bypass no validation and use no aggregate memo. */
test('profile distinct-period quantity, sleep, activity and availability aggregation', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const rows: unknown[] = [];
  try {
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const base = healthObservation(
      'seed',
      'heart_rate',
      '2023-01-01T00:00:00.000Z',
    );
    for (const size of [1000, 10000, 100000]) {
      await f.database.execute('DELETE FROM health_observations');
      for (const [prefix, count, concept, text, duration] of [
        ['heart', size, 'heart_rate', null, 60],
        ['sleep', size / 10, 'sleep', 'asleepCore', 28800],
        ['workout', size / 100, 'workout_duration', null, 3600],
      ] as const) {
        const template = {
          ...base,
          concept,
          ...(text ? { value: { kind: 'text', text } } : {}),
        };
        await f.database.execute(
          `INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json)
          WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?), samples AS (
          SELECT i, strftime('%Y-%m-%dT%H:%M:%fZ', '2023-01-01', '+'||(i%40000)||' minutes') AS at FROM n)
          SELECT ?||i, at, at, ?, json_set(?, '$.id', ?||i, '$.effectiveAt', at,
          '$.endedAt', strftime('%Y-%m-%dT%H:%M:%fZ',at,'+'||?||' seconds')) FROM samples`,
          [
            count,
            prefix,
            base.ingestedAt,
            JSON.stringify(template),
            prefix,
            duration,
          ],
        );
      }
      for (const calendarDays of [30, 365, 1461]) {
        const days = healthContextDays({
          fromInclusive: '2023-01-01T00:00:00.000Z',
          toExclusive: new Date(
            Date.parse('2023-01-01T00:00:00Z') + calendarDays * 86400000,
          ).toISOString(),
          timeZone: 'UTC',
        });
        let label = 'quantity';
        const executor: SqlExecutor = {
          execute: async (sql, bindings) => {
            const plan = await f.database.execute(
              `EXPLAIN QUERY PLAN ${sql}`,
              bindings,
            );
            const start = performance.now();
            const result = await f.database.execute(sql, bindings);
            const entry = {
              size,
              calendarDays,
              label,
              ms: performance.now() - start,
              rows: result.rows.length,
              plan: plan.rows.map(row => String(row.detail)),
            };
            rows.push(entry);
            console.info(JSON.stringify({ ...entry, plan: undefined }));
            return result;
          },
        };
        const quantity = await readHealthQuantityContext(
          executor,
          days,
          undefined,
          'measurements',
          '2027-01-01T00:00:00Z',
        );
        expect(
          quantity.series
            .flatMap(s => s.days)
            .reduce((n, d) => n + d.samples, 0),
        ).toBe(size);
        label = 'heartActivity';
        await addHeartRateActivityContext(
          executor,
          days,
          quantity.series,
          undefined,
          '2027-01-01T00:00:00Z',
        );
        label = 'activity';
        const activity = await readHealthQuantityContext(
          executor,
          days,
          undefined,
          'activity',
          '2027-01-01T00:00:00Z',
        );
        expect(
          activity.series
            .flatMap(s => s.days)
            .reduce((n, d) => n + d.samples, 0),
        ).toBe(size / 100);
        if (size === 100000 && calendarDays === 1461) {
          // Test-only physical index prototype; never changes repository production SQL.
          await f.database.execute(
            `CREATE INDEX profile_activity_time ON health_observations(lower(json_extract(payload_json, '$.concept')), ${localQueryTimestampKeyExpression('effective_at')})`,
          );
          label = 'activityIndexedPrototype';
          const indexed = await readHealthQuantityContext(
            executor,
            days,
            undefined,
            'activity',
            '2027-01-01T00:00:00Z',
          );
          expect(indexed).toEqual(activity);
          await f.database.execute('DROP INDEX profile_activity_time');
        }
        label = 'sleep';
        const sleep = await readHealthSleepContext(
          executor,
          days,
          undefined,
          '2027-01-01T00:00:00Z',
        );
        expect(sleep.days.length).toBeGreaterThan(0);
        if (calendarDays === 1461) {
          label = 'available';
          expect(
            await readAvailableHealthContextWindow(
              executor,
              undefined,
              '2027-01-01T00:00:00Z',
              'UTC',
            ),
          ).not.toBeNull();
        }
      }
    }
    writeFileSync(
      '/tmp/aggregate-validation-profile.json',
      JSON.stringify(rows),
    );
  } finally {
    f.close();
  }
}, 180000);
