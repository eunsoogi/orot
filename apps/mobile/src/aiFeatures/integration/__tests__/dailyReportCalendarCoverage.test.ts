import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { conversationDailyReportText } from '../conversationDailyReportText';
import {
  calendarFixture,
  calendarReportService,
  calendarTestObservation,
  calendarTestRequest,
} from '../testSupport/dailyReportCalendarTestFixture';

test.each(['denied', 'read_error', 'scoped'] as const)(
  'calendar %s never widens authorization or means no plans',
  async mode => {
    const connection = openSqliteTestDatabase(':memory:');
    const native = calendarFixture();
    const read = jest.fn(native.read);
    try {
      await runMigrations(connection.database);
      await createRecordRepository(connection.database).put(
        'health_observation',
        calendarTestObservation,
      );
      if (mode === 'denied') native.revoke();
      if (mode === 'read_error')
        read.mockRejectedValueOnce(new Error('synthetic unavailable'));
      const { run, consent } = calendarReportService(connection.database, {
        ...native,
        read,
      });
      const result = await run({
        ...calendarTestRequest(),
        scope: mode === 'scoped' ? { sourceIds: ['synthetic'] } : {},
      });
      if (result.status !== 'completed')
        throw new Error(JSON.stringify(result));
      expect(result.context.systemCalendar).toBeUndefined();
      expect(result.report.coverage).toContainEqual({
        source: 'system_calendar',
        status: 'unknown',
        limitationCodes: [
          mode === 'scoped'
            ? 'calendar_scoped_out'
            : 'calendar_read_unavailable',
        ],
      });
      expect(
        consent.mock.calls[0]?.[0].consentScope?.dataCategories,
      ).not.toContain('calendar_plans');
      expect(read).toHaveBeenCalledTimes(mode === 'scoped' ? 0 : 1);
      const saved = await createDailyReportStorage(
        connection.database,
        read,
      ).lookup(result.context.identity);
      if (saved.status !== 'saved') throw new Error('Expected a stored report');
      const warning = '시스템 캘린더 기록을 확인하지 못했어요.';
      expect(conversationDailyReportText(saved)).not.toContain(warning);
      expect(saved.report.coverage).toEqual(result.report.coverage);
      expect(native.listeners.size).toBe(0);
    } finally {
      connection.close();
    }
  },
);
