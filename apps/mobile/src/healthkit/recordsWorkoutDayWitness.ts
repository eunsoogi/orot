export type WorkoutDayStatistics = Readonly<{
  sampleCount: number;
  minimum: number;
  mean: number;
  maximum: number;
}>;

export type RecordsWorkoutDay = Readonly<{
  date: string;
  statistics: WorkoutDayStatistics | null;
}>;

type WorkoutPeriodWitness = WorkoutDayStatistics & {
  readonly fromInclusive: string;
  readonly toExclusive: string;
};

/** Read the dates in the frozen request zone, then advance civil date keys in UTC
 * to avoid imposing 24-hour durations on the actual DST-sensitive local days.
 */
function requestDays(period: WorkoutPeriodWitness, timeZone: string) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const key = (value: string | number) => {
    const parts = format.formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find(item => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const first = Date.parse(key(period.fromInclusive));
  const last = Date.parse(key(Date.parse(period.toExclusive) - 1));
  const days: string[] = [];
  for (let day = first; day <= last && days.length <= 33; day += 86_400_000)
    days.push(new Date(day).toISOString().slice(0, 10));
  return days.length <= 33 ? days : [];
}

function statistics(
  value: Partial<WorkoutDayStatistics>,
): WorkoutDayStatistics | null {
  const { minimum, mean, maximum, sampleCount } = value;
  return typeof minimum === 'number' &&
    typeof mean === 'number' &&
    typeof maximum === 'number' &&
    [minimum, mean, maximum].every(Number.isFinite) &&
    minimum > 0 &&
    minimum <= mean &&
    mean <= maximum &&
    typeof sampleCount === 'number' &&
    Number.isSafeInteger(sampleCount) &&
    sampleCount > 0 &&
    (sampleCount !== 1 || (minimum === mean && mean === maximum))
    ? { minimum, mean, maximum, sampleCount }
    : null;
}

/** Chart only a proved partition of the very same admitted quantities as the headline.
 * An old bridge, duplicate day, out-of-window day, or any mismatched total leaves the chart absent.
 */
export function validatedRecordsWorkoutDays(
  output: { days?: unknown; timeZone?: unknown },
  period: WorkoutPeriodWitness,
  timeZone: string | undefined,
): readonly RecordsWorkoutDay[] | undefined {
  if (
    !timeZone ||
    output.timeZone !== timeZone ||
    !Array.isArray(output.days) ||
    output.days.length < 1 ||
    output.days.length > 33
  )
    return;
  let expected;
  try {
    expected = requestDays(period, timeZone);
  } catch {
    return;
  }
  const byDay = new Map<string, WorkoutDayStatistics>();
  for (const row of output.days as unknown[]) {
    if (!row || typeof row !== 'object') return;
    const value = row as Partial<WorkoutDayStatistics> & { date?: unknown };
    const { date } = value;
    const stat = statistics(value);
    if (
      !stat ||
      typeof date !== 'string' ||
      !expected.includes(date) ||
      byDay.has(date)
    )
      return;
    byDay.set(date, stat);
  }
  const values = [...byDay.values()];
  const count = values.reduce((n, stat) => n + stat.sampleCount, 0);
  const mean = values.reduce(
    (sum, stat) => sum + stat.mean * (stat.sampleCount / count),
    0,
  );
  if (
    count !== period.sampleCount ||
    Math.min(...values.map(stat => stat.minimum)) !== period.minimum ||
    Math.max(...values.map(stat => stat.maximum)) !== period.maximum ||
    Math.abs(mean - period.mean) > 1e-9 * Math.max(1, Math.abs(period.mean))
  )
    return;
  return expected.map(date => ({
    date,
    statistics: byDay.get(date) ?? null,
  }));
}
