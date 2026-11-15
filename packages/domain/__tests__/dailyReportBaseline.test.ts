import {
  dailyReportBaselineInterval,
  validDailyReportBaseline,
  validDailyReportHistoricalContext,
} from '../src';

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

test('behavior history roles are limited to their original source kind and prior-day boundary', () => {
  const record = {
    source: 'dose_event',
    contextRole: 'medication_history',
    occurrence: { startInclusive: '2026-11-09T12:00:00Z' },
  };
  expect(validDailyReportHistoricalContext(record, '2026-11-10', 'UTC')).toBe(true);
  expect(
    validDailyReportHistoricalContext({ ...record, source: 'appointment' }, '2026-11-10', 'UTC'),
  ).toBe(false);
  expect(
    validDailyReportHistoricalContext(
      { ...record, contextRole: 'activity_history' },
      '2026-11-10',
      'UTC',
    ),
  ).toBe(false);
  expect(
    validDailyReportHistoricalContext(
      { ...record, source: 'health_observation', contextRole: 'activity_history' },
      '2026-11-10',
      'UTC',
    ),
  ).toBe(true);
  expect(
    validDailyReportHistoricalContext(
      {
        ...record,
        occurrence: {
          startInclusive: '2026-11-09T23:00:00Z',
          endExclusive: '2026-11-10T01:00:00Z',
        },
      },
      '2026-11-10',
      'UTC',
    ),
  ).toBe(false);
});

test('ongoing symptoms retain older onset but cannot borrow another source or a resolved interval', () => {
  const record = {
    source: 'symptom_entry',
    contextRole: 'ongoing_symptom',
    occurrence: { startInclusive: '2026-01-01T12:00:00Z' },
  };
  expect(validDailyReportHistoricalContext(record, '2026-11-10', 'UTC')).toBe(true);
  for (const change of [
    { source: 'health_observation' },
    { supportingRecordFor: ['x'] },
    { occurrence: { startInclusive: '2026-11-10T00:00:00Z' } },
    {
      occurrence: { startInclusive: '2026-01-01T12:00:00Z', endExclusive: '2026-11-09T12:00:00Z' },
    },
  ])
    expect(validDailyReportHistoricalContext({ ...record, ...change }, '2026-11-10', 'UTC')).toBe(
      false,
    );
});
