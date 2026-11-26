import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from '../dailyReportFacts';
import { reportObservation } from '../testSupport/dailyReportFailureStageFixtures';

function reading(
  effectiveAt: string,
  amount: number,
  unit = 'count/min',
  concept = 'heart_rate',
) {
  return {
    kind: 'health_observation' as const,
    record: {
      ...reportObservation,
      effectiveAt,
      concept,
      value: { kind: 'quantity' as const, amount, unit },
    },
  };
}

test('the same exact instant preserves alias, incompatible-unit and value membership in original concept order', () => {
  const at = '2035-01-01T01:00:00.123456Z';
  const offset = '2034-12-31T20:00:00.12345600-05:00';
  const different = '2035-01-01T01:00:00.123457Z';
  const values = [
    reading(at, 120, 'mmHg', 'Blood Pressure Systolic'),
    reading(at, 72),
    reading(different, 88),
    reading(offset, 124, 'mmHg', 'blood_pressure_systolic'),
    reading(offset, 75),
    reading(at, 1, 'Hz'),
    reading(at, 72),
    reading(at, 95, 'kPa', 'blood_pressure_systolic'),
    reading(at, 80, 'mmHg', 'blood_pressure_diastolic'),
  ];
  expect(conflictingDailyReportIndexes(values)).toEqual([0, 3, 1, 4, 6]);
  expect(incomparableDailyReportIndexes(values)).toEqual([0, 3, 7, 1, 4, 5, 6]);
});

test('distinct dense samples do not repeat timestamp parsing for every pair', () => {
  const values = Array.from({ length: 512 }, (_, index) =>
    reading(
      new Date(Date.UTC(2035, 0, 1, 0, 0, 511 - index)).toISOString(),
      72,
    ),
  );
  const parse = jest.spyOn(Date, 'parse');
  let calls: number;
  try {
    expect(conflictingDailyReportIndexes(values)).toEqual([]);
    expect(incomparableDailyReportIndexes(values)).toEqual([]);
    calls = parse.mock.calls.length;
  } finally {
    parse.mockRestore();
  }

  expect(calls).toBeLessThan(30_000);
});
