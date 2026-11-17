import { runMigrations, type SqlExecutor } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { readHealthSleepContext } from '../sleepQuery';
import { sleepIntervalCalendarSql } from '../sleepIntervalCalendarSql';
import { healthContextDays } from '../window';

const priorJoin = `samples AS MATERIALIZED (
 SELECT d.date,max(o.start,d.from_at)*86400 AS start,min(o.finish,d.to_at)*86400 AS finish,o.stage
 FROM observations o JOIN days d ON o.start<d.to_at AND o.finish>d.from_at
)`;

test.each([
  ['2026-03-08T05:00:00.000Z', '2026-03-11T04:00:00.000Z', 23],
  ['2026-11-01T04:00:00.000Z', '2026-11-04T05:00:00.000Z', 25],
] as const)(
  'interval sweep matches the prior join at %s including DST and multi-day edges',
  async (from, to, firstDayHours) => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      const days = healthContextDays({
        fromInclusive: from,
        toExclusive: to,
        timeZone: 'America/New_York',
      });
      expect(
        (Date.parse(days[0]!.toExclusive) -
          Date.parse(days[0]!.fromInclusive)) /
          3600000,
      ).toBe(firstDayHours);
      const start = Date.parse(from),
        end = Date.parse(to),
        boundary = Date.parse(days[1]!.fromInclusive);
      const ranges = [
        [start - 3600000, end + 3600000, '3'], // clipped multi-day
        [start, boundary, '3'],
        [start, boundary, '3'], // duplicate stage
        [start + 1800000, boundary + 3600000, '4'], // different-stage overlap
        [boundary, boundary + 3600000, '2'],
        [boundary, boundary + 3600000, '999'],
        [start - 3600000, start, '3'],
        [end, end + 3600000, '3'], // half-open touching only
        [boundary, boundary, '3'],
        [boundary + 1000, boundary, '3'], // zero/reversed
      ] as const;
      for (const [index, [a, b, stage]] of ranges.entries()) {
        const row = {
          ...healthObservation(
            `sample-${index}`,
            'sleep',
            new Date(a).toISOString(),
            'healthkit',
            'imported',
            new Date(b).toISOString(),
          ),
          value: { kind: 'text', text: stage },
        };
        await f.database.execute(
          'INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) VALUES(?,?,?,?,?)',
          [
            row.id,
            row.effectiveAt,
            row.recordedAt!,
            row.ingestedAt,
            JSON.stringify(row),
          ],
        );
      }
      const legacy: SqlExecutor = {
        execute: (sql, args) =>
          f.database.execute(
            sql.replace(sleepIntervalCalendarSql, priorJoin),
            args,
          ),
      };
      const plans: string[] = [];
      const observed: SqlExecutor = {
        execute: async (sql, args) => {
          plans.push(
            ...(
              await f.database.execute('EXPLAIN QUERY PLAN ' + sql, args)
            ).rows.map(row => String(row.detail)),
          );
          return f.database.execute(sql, args);
        },
      };
      const result = await readHealthSleepContext(observed, days);
      expect(result).toEqual(await readHealthSleepContext(legacy, days));
      expect(result.days).toHaveLength(3);
      expect(result.unsupportedCategories).toBe(true);
      expect(plans.some(plan => /SEARCH d.*day_index=/.test(plan))).toBe(true);
      expect(result.days[0]!.asleepSeconds).toBe(firstDayHours * 3600);
    } finally {
      f.close();
    }
  },
);

test.each([
  'gap',
  'overlap',
  'unsorted',
  'submillisecond-gap',
  'offset-contiguous',
] as const)(
  '%s supplied calendar preserves the original interval join',
  async kind => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      const a = {
        date: '2026-01-01',
        fromInclusive: '2026-01-01T00:00:00.000Z',
        toExclusive: '2026-01-02T00:00:00.000Z',
        partial: false,
      };
      const b = {
        ...a,
        date: '2026-01-02',
        fromInclusive: '2026-01-02T00:00:00.000Z',
        toExclusive: '2026-01-03T00:00:00.000Z',
      };
      const days =
        kind === 'offset-contiguous'
          ? [
              {
                ...a,
                fromInclusive: '2026-01-01T14:00:00+14:00',
                toExclusive: '2026-01-02T14:00:00+14:00',
              },
              {
                ...b,
                fromInclusive: '2026-01-01T12:00:00-12:00',
                toExclusive: '2026-01-02T12:00:00-12:00',
              },
            ]
          : kind === 'unsorted'
            ? [b, a]
            : [
                a,
                {
                  ...b,
                  fromInclusive:
                    kind === 'gap'
                      ? '2026-01-02T04:00:00.000Z'
                      : kind === 'overlap'
                        ? '2026-01-01T22:00:00.000Z'
                        : '2026-01-02T00:00:00.0001Z',
                },
              ];
      const row = {
        ...healthObservation(
          'interval',
          'sleep',
          '2026-01-02T02:00:00.000Z',
          'healthkit',
          'imported',
          '2026-01-02T07:00:00.000Z',
        ),
        value: { kind: 'text', text: '3' },
      };
      await f.database.execute(
        'INSERT INTO health_observations(id,effective_at,recorded_at,ingested_at,payload_json) VALUES(?,?,?,?,?)',
        [
          row.id,
          row.effectiveAt,
          row.recordedAt!,
          row.ingestedAt,
          JSON.stringify(row),
        ],
      );
      let query = '';
      const observed: SqlExecutor = {
        execute: (sql, args) => {
          query = sql;
          return f.database.execute(sql, args);
        },
      };
      const actual = await readHealthSleepContext(observed, days);
      if (kind === 'offset-contiguous')
        expect(query).toContain('calendar_sweep');
      else expect(query).not.toContain('calendar_sweep');
      const legacy: SqlExecutor = {
        execute: (sql, args) =>
          f.database.execute(
            sql.replace(sleepIntervalCalendarSql, priorJoin),
            args,
          ),
      };
      expect(actual).toEqual(await readHealthSleepContext(legacy, days));
      if (kind === 'gap') expect(actual.days[0]?.asleepSeconds).toBe(3 * 3600);
    } finally {
      f.close();
    }
  },
);
