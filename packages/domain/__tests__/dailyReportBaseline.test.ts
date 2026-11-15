import { dailyReportBaselineInterval, validDailyReportBaseline } from '../src';

test('baseline spans 28 local civil days including DST rather than fixed elapsed hours', () => {
  expect(dailyReportBaselineInterval('2026-11-10', 'America/New_York')).toEqual({
    fromInclusive: '2026-10-13T04:00:00.000Z',
    toExclusive: '2026-11-10T05:00:00.000Z',
  });
});
test('historical role rejects other sources, support links, future and out-of-range records', () => {
  const record = {
    source: 'health_observation',
    contextRole: 'personal_baseline',
    occurrence: { startInclusive: '2026-11-09T12:00:00Z' },
  };
  expect(validDailyReportBaseline(record, '2026-11-10', 'UTC')).toBe(true);
  for (const change of [
    { source: 'dose_event' },
    { supportingRecordFor: ['x'] },
    { occurrence: { startInclusive: '2026-11-10T00:00:00Z' } },
    { occurrence: { startInclusive: '2026-10-01T00:00:00Z' } },
  ])
    expect(validDailyReportBaseline({ ...record, ...change }, '2026-11-10', 'UTC')).toBe(false);
});
