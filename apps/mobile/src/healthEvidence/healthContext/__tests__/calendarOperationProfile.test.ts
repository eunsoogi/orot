import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';
import { HEALTH_CONTEXT_TOPICS } from '../types';
import * as calendar from '../window';
import { dayFormatter } from '../calendarDate';
import { healthContextRevision } from '../scope';

/** Synthetic empty protected-store profile isolates calendar construction from
 * samples and query volume. Timings are Node, not Hermes or device CPU evidence. */
test.each([90, 365, 1461])(
  'profiles same-operation topic calendar reuse across %i days',
  async days => {
    const f = openSqliteTestDatabase(':memory:');
    const original = calendar.healthContextDays;
    const measurements: { ms: number; intl: number }[] = [];
    for (const zone of [
      'Asia/Tokyo',
      'Pacific/Apia',
      'Europe/London',
      'America/New_York',
    ])
      dayFormatter(zone);
    const formatter = dayFormatter('UTC');
    const format = jest.spyOn(formatter, 'formatToParts');
    const dayCalls = jest
      .spyOn(calendar, 'healthContextDays')
      .mockImplementation(window => {
        const before = format.mock.calls.length;
        const start = performance.now();
        const result = original(window);
        measurements.push({
          ms: performance.now() - start,
          intl: format.mock.calls.length - before,
        });
        return result;
      });
    try {
      await runMigrations(f.database);
      let sqlMs = 0;
      const database: SqlDatabase = {
        ...f.database,
        transaction: work =>
          f.database.transaction(tx =>
            work({
              ...tx,
              execute: async (q, p) => {
                const start = performance.now();
                const result = await tx.execute(q, p);
                sqlMs += performance.now() - start;
                return result;
              },
            }),
          ),
      };
      const operation = beginHealthContextReadOperation(
        createHealthContextReader(database),
      )!;
      const window = {
        fromInclusive: '2020-01-01T00:00:00.000Z',
        toExclusive: new Date(
          Date.UTC(2020, 0, 1) + days * 86400000,
        ).toISOString(),
        timeZone: 'UTC',
      };
      try {
        for (const topic of HEALTH_CONTEXT_TOPICS) {
          const before = measurements.length;
          const beforeSql = sqlMs;
          const start = performance.now();
          const report = await operation.read(window, [topic]);
          const readerMs = performance.now() - start;
          const scope = {
            kind: 'health_context_period' as const,
            version: 1 as const,
            topic,
            window,
          };
          const revisionStart = performance.now();
          const first = healthContextRevision(scope, report);
          for (let i = 0; i < 4; i++)
            expect(healthContextRevision(scope, report)).toBe(first);
          console.info(
            'SYNTHETIC_CALENDAR_OPERATION',
            JSON.stringify({
              days,
              topic,
              readerMs,
              sqlMs: sqlMs - beforeSql,
              calendars: measurements.slice(before),
              fiveRevisionMs: performance.now() - revisionStart,
            }),
          );
          expect(report.days).toHaveLength(days);
        }
        expect(measurements).toHaveLength(1);
        expect(measurements.slice(1)).toEqual([]);
      } finally {
        operation.dispose();
      }
    } finally {
      dayCalls.mockRestore();
      format.mockRestore();
      f.close();
    }
  },
  60000,
);
