import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { addHeartRateActivityContext } from '../heartRateActivity';
import { healthContextDays } from '../window';
import type { HealthContextDay, HealthQuantitySeries } from '../types';

function series(days: readonly HealthContextDay[]): HealthQuantitySeries[] {
  return [
    {
      concept: 'heart_rate',
      unit: 'count/min',
      source: 'com.example.synthetic:',
      days: days.map(day => ({
        date: day.date,
        samples: 0,
        minimum: 0,
        maximum: 0,
        mean: 0,
        sum: 0,
        latest: 0,
        firstAt: day.fromInclusive,
        lastAt: day.fromInclusive,
      })),
    },
  ];
}

/** Replay the previous correlated calendar query against the identical synthetic database.
 * Timing is reported, never asserted: correctness and the absence of a correlated date lookup are deterministic checks. */
function legacyCalendar(query: string): string {
  return query
    .replace('undated_heart AS MATERIALIZED', 'heart AS MATERIALIZED')
    .replace(/, calendar_events AS \([\s\S]*?\), events AS \(/, ', events AS (')
    .replace(
      'NULL, NULL, NULL, NULL, NULL, NULL, start_key',
      'NULL, NULL, NULL, NULL, NULL, start_key',
    )
    .replace(
      'SELECT h.*,\n        CASE WHEN',
      `SELECT h.*, (SELECT date FROM days WHERE h.start_key >= from_key AND h.start_key < to_key LIMIT 1) AS date,\n        CASE WHEN`,
    );
}

test.each([30, 180])(
  'calendar sweep preserves all %i days without a correlated calendar scan',
  async count => {
    const f = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(f.database);
      const records = createRecordRepository(f.database);
      const base = Date.UTC(2025, 0, 1);
      const iso = (day: number, sample = 0) =>
        new Date(base + day * 86400000 + sample * 60000).toISOString();
      const days = healthContextDays({
        fromInclusive: iso(0),
        toExclusive: iso(count),
        timeZone: 'UTC',
      });
      for (let day = 0; day < count; day++) {
        for (let sample = 0; sample < 20; sample++) {
          await records.put(
            'health_observation',
            healthObservation(
              `heart-${day}-${sample}`,
              'heart_rate',
              iso(day, sample),
              'healthkit',
              'imported',
              iso(day, sample),
            ),
          );
        }
      }
      let query = '';
      let parameters: Parameters<SqlExecutor['execute']>[1];
      const capture: SqlExecutor = {
        execute: async (sql, values) => {
          query = sql;
          parameters = values;
          return f.database.execute(sql, values);
        },
      };
      const started = performance.now();
      const result = await addHeartRateActivityContext(
        capture,
        days,
        series(days),
      );
      const sweepMs = performance.now() - started;
      const previous = legacyCalendar(query);
      expect(previous).not.toContain('calendar_timeline');
      const legacyStarted = performance.now();
      const legacy = await f.database.execute(previous, parameters);
      const legacyMs = performance.now() - legacyStarted;
      const current = await f.database.execute(query, parameters);
      expect(current.rows).toEqual(legacy.rows);
      expect(result[0]!.days).toHaveLength(count);
      expect(
        result[0]!.days.every(day => day.activityContext?.[0]?.samples === 20),
      ).toBe(true);
      expect(query).not.toMatch(/SELECT date FROM days WHERE h.start_key/);
      expect(query).toContain('ORDER BY start_key, boundary_order');
      console.info(
        JSON.stringify({
          benchmark: 'heart_calendar',
          days: count,
          samples: count * 20,
          sweepMs,
          legacyMs,
        }),
      );
    } finally {
      f.close();
    }
  },
  120000,
);

test.each([
  [
    '2026-03-08T05:00:00.0000001Z',
    '2026-03-10T04:00:00.0000001Z',
    '2026-03-09T04:00:00Z',
  ],
  [
    '2026-11-01T04:00:00.0000001Z',
    '2026-11-03T05:00:00.0000001Z',
    '2026-11-02T05:00:00Z',
  ],
])(
  'calendar sweep preserves DST and submillisecond half-open endpoints from %s',
  async (from, to, midnight) => {
    const f = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(f.database);
      const records = createRecordRepository(f.database);
      const days = healthContextDays({
        fromInclusive: from,
        toExclusive: to,
        timeZone: 'America/New_York',
      });
      const before = from.replace('0000001', '0000000');
      for (const [index, at] of [
        before,
        from,
        midnight,
        to.replace('0000001', '0000000'),
        to,
      ].entries()) {
        await records.put('health_observation', {
          ...healthObservation(
            `edge-${index}`,
            'heart_rate',
            at,
            'healthkit',
            'imported',
            at,
          ),
          ingestedAt: '2026-12-01T00:00:00Z',
        });
      }
      const result = await addHeartRateActivityContext(
        f.database,
        days,
        series(days),
      );
      expect(
        result[0]!.days.map(day => day.activityContext?.[0]?.samples ?? 0),
      ).toEqual([1, 1, 1]);
    } finally {
      f.close();
    }
  },
);
