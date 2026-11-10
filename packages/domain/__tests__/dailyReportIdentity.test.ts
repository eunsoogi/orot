import {
  createDailyReportIdentity,
  dailyReportCalendarInterval,
  DailyReportIdentitySchema,
  DailyReportContextRequestSchema,
} from '../src';

const requestedAt = '2026-11-10T04:00:00.000Z';

test('uses a stable identity for a canonical local date and timezone', () => {
  const request = DailyReportContextRequestSchema.parse({
    localDate: '2026-11-10',
    timeZone: 'Asia/Seoul',
    requestedAt,
  });
  const alias = createDailyReportIdentity('2026-11-10', 'US/Eastern');
  const canonical = createDailyReportIdentity('2026-11-10', 'America/New_York');

  expect(request.localDate).toBe('2026-11-10');
  expect(alias).toEqual(canonical);
  expect(alias.key).toBe('daily-report:2026-11-10@America/New_York');
  expect(
    DailyReportIdentitySchema.safeParse({
      ...alias,
      timeZone: 'US/Eastern',
      key: 'daily-report:2026-11-10@US/Eastern',
    }).success,
  ).toBe(false);
  expect(dailyReportCalendarInterval('2011-12-30', 'Pacific/Apia')).toBeUndefined();
  expect(
    DailyReportContextRequestSchema.safeParse({
      ...request,
      localDate: '2026-02-30',
    }).success,
  ).toBe(false);
  expect(
    DailyReportContextRequestSchema.safeParse({
      ...request,
      timeZone: 'not/a-timezone',
    }).success,
  ).toBe(false);
});
