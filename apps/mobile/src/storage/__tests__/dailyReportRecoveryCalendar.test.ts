import { createDailyReportStorage } from '../dailyReportStorage';
jest.mock('../../agent/execution/consentFingerprint', () => ({
  fingerprintConsentSnapshot: async (value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { dailyReportRecoveryFixture } from '../testSupport/dailyReportRecoveryFixture';
import { createDailyReportLocalRecovery } from '../dailyReportLocalRecovery';
import { calendarFixture } from '../../aiFeatures/integration/testSupport/dailyReportCalendarTestFixture';
import { prepareReportCalendar } from '../../aiFeatures/integration/dailyReportSystemCalendar';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { failTransactionQuery } from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';

test.each([
  'before resume',
  'during stage',
  'final stage read',
  'during save',
] as const)(
  'native calendar change %s rejects local recovery without a provider',
  async when => {
    const c = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    try {
      const { candidate, witness } = await dailyReportRecoveryFixture(
        c.database,
      );
      const calendar = createDailyReportCalendarWindow({
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      });
      if (calendar.status !== 'ready') throw new Error('Invalid calendar');
      const prepared = await prepareReportCalendar(
        calendar.context,
        native.read,
      );
      const bound = {
        ...candidate,
        context: {
          ...candidate.context,
          systemCalendar: prepared.binding,
          sourceSnapshot: {
            ...candidate.context.sourceSnapshot,
            records: [
              ...candidate.context.sourceSnapshot.records,
              prepared.source,
            ],
          },
        },
      };
      prepared.snapshot.dispose();
      let changed = false;
      const database = failTransactionQuery(
        c.database,
        query => {
          if (
            !changed &&
            ((when === 'during stage' &&
              query.startsWith(
                'INSERT OR IGNORE INTO daily_report_pending VALUES',
              )) ||
              (when === 'final stage read' &&
                query.startsWith('SELECT candidate_json, owner_json')) ||
              (when === 'during save' &&
                query.startsWith('INSERT INTO symptom_summary_runs')))
          ) {
            changed = true;
            native.revoke();
          }
          return false;
        },
        'unused',
      );
      const recovery = createDailyReportLocalRecovery(database, native.read);
      const signal = new AbortController().signal;
      expect(await recovery.stage(bound, witness, signal)).toEqual({
        status:
          when === 'during stage' || when === 'final stage read'
            ? 'unavailable'
            : 'staged',
      });
      if (when === 'before resume') native.revoke();
      expect(await recovery.resume(candidate.runId, witness, signal)).toEqual({
        status: 'unavailable',
      });
      expect(
        JSON.stringify(
          (
            await c.database.execute(
              'SELECT candidate_json FROM daily_report_pending',
            )
          ).rows,
        ),
      ).not.toContain('Synthetic report');
      // Existing calendar save guard invalidates a write if native permission changes after its INSERT.
      await expect(
        createDailyReportStorage(c.database, native.read).lookup(
          candidate.context.identity,
        ),
      ).resolves.not.toMatchObject({ status: 'saved' });
      expect(native.listeners.size).toBe(0);
    } finally {
      c.close();
    }
  },
);
