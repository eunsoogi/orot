jest.mock('../../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (text: string) =>
    require('node:crypto').createHash('sha256').update(text).digest('hex'),
}));
import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportService } from '../dailyReportService';
import { calendarFixture } from '../testSupport/dailyReportCalendarTestFixture';
import {
  prepareReportDatabase,
  reportObservation,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../testSupport/dailyReportFailureStageFixtures';

// Actual SQLite/service/authorization and calendar callbacks; only the model and
// native calendar bridge are synthetic. No external transport is contacted.
test.each(['scope', 'cancel', 'grant', 'post-send scope'] as const)(
  'readmission rejects %s replacement during the final async calendar check',
  async change => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await prepareReportDatabase(f.database);
      const calendar = calendarFixture();
      const controller = new AbortController();
      const request = reportRequest(controller.signal);
      const provider = reportProvider();
      const generate = jest.spyOn(provider, 'generate');
      let decisions = 0;
      let current = true;
      let injected = 0;
      const run = createDailyReportService({
        database: f.database,
        now: () => '2035-01-01T12:00:00Z',
        createRunId: () => 'calendar-owner-race',
        resolveSelected: async () => selectedReportProvider(provider, true),
        consent: {
          authorize: async () => {
            decisions++;
            if (decisions === 1)
              await createRecordRepository(f.database).put(
                'health_observation',
                {
                  ...reportObservation,
                  value: { kind: 'quantity', amount: 99, unit: 'count/min' },
                },
              );
            return 'authorized';
          },
          isAuthorizationCurrent: () => current,
        },
        calendarReader: async (...args) => {
          const snapshot = await calendar.read(...args);
          return {
            ...snapshot,
            revalidate: async signal => {
              const valid = await snapshot.revalidate(signal);
              if (
                decisions === 2 &&
                injected === 0 &&
                (change !== 'post-send scope' ||
                  generate.mock.calls.length === 1)
              ) {
                injected++;
                if (change === 'scope' || change === 'post-send scope')
                  Object.assign(request.scope, { sourceIds: ['other-owner'] });
                if (change === 'cancel') controller.abort();
                if (change === 'grant') current = false;
              }
              return valid;
            },
          };
        },
      });
      const result = await run(request);
      expect(decisions).toBe(2);
      expect(injected).toBe(1);
      expect(generate).toHaveBeenCalledTimes(
        change === 'post-send scope' ? 1 : 0,
      );
      expect(result.status).toBe('failed');
      expect(
        (
          await f.database.execute(
            'SELECT identity_key FROM daily_report_heads',
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await createRecordRepository(f.database).get(
            'health_observation',
            reportObservation.id,
          )
        )?.value,
      ).toEqual({ kind: 'quantity', amount: 99, unit: 'count/min' });
      if (change !== 'grant') {
        // A terminated request must not poison the next explicit owner.
        const next = await run(reportRequest());
        expect(next.status).toBe('completed');
        expect(generate).toHaveBeenCalledTimes(
          change === 'post-send scope' ? 2 : 1,
        );
      }
    } finally {
      f.close();
    }
  },
);
