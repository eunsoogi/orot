import { validatedRecordsWorkoutDays } from '../recordsWorkoutDayWitness';

const timeZone = 'America/Los_Angeles';
const period = {
  fromInclusive: '2026-03-02T07:30:00.000Z',
  toExclusive: '2026-04-02T07:30:00.001Z',
  sampleCount: 4,
  minimum: 90,
  mean: 112.5,
  maximum: 150,
};
const days = [
  { date: '2026-03-08', sampleCount: 3, minimum: 90, mean: 100, maximum: 110 },
  { date: '2026-04-02', sampleCount: 1, minimum: 150, mean: 150, maximum: 150 },
];

test('preserves real 33 local-day slots in an exact 31-day UTC month through DST', () => {
  const result = validatedRecordsWorkoutDays(
    { timeZone, days },
    period,
    timeZone,
  );
  expect(result).toHaveLength(33);
  expect(result?.[0]).toEqual({ date: '2026-03-01', statistics: null });
  expect(result?.at(-1)).toMatchObject({
    date: '2026-04-02',
    statistics: { sampleCount: 1, minimum: 150, mean: 150, maximum: 150 },
  });
  expect(result?.filter(day => day.statistics !== null)).toHaveLength(2);
});

test.each([
  { timeZone, days: [...days, days[0]] },
  { timeZone, days: [{ ...days[0], date: '2026-02-28' }, days[1]] },
  { timeZone, days: [{ ...days[0], mean: 105 }, days[1]] },
  { timeZone, days: [days[0], { ...days[1], minimum: 140 }] },
  { timeZone: 'UTC', days },
  {},
])(
  'rejects chart receipt unrelated to the exact whole-period aggregate: %p',
  output => {
    expect(
      validatedRecordsWorkoutDays(output, period, timeZone),
    ).toBeUndefined();
  },
);
