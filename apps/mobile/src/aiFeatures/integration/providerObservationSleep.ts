import { compareTimestamps } from '@orot/domain';
import type { HealthObservation } from '@orot/domain';

const sleepStages: Readonly<Record<string, string>> = {
  '0': 'inBed',
  inBed: 'inBed',
  '1': 'asleepUnspecified',
  asleepUnspecified: 'asleepUnspecified',
  '2': 'awake',
  awake: 'awake',
  '3': 'asleepCore',
  asleepCore: 'asleepCore',
  '4': 'asleepDeep',
  asleepDeep: 'asleepDeep',
  '5': 'asleepREM',
  asleepREM: 'asleepREM',
};

type Interval = { start: string; end: string };
function fractionalSeconds(value: string): number {
  const fraction = value.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i)?.[1] ?? '';
  return Number(`0.${fraction.slice(3) || '0'}`) / 1000;
}
function elapsedSeconds(start: string, end: string): number {
  return (
    (Date.parse(end) - Date.parse(start)) / 1000 +
    fractionalSeconds(end) -
    fractionalSeconds(start)
  );
}
/** Merge exact ordered intervals before duration math; duplicate and overlapping imports do not add time. */
function unionSeconds(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort(
    (a, b) =>
      compareTimestamps(a.start, b.start) || compareTimestamps(a.end, b.end),
  );
  let active: Interval | undefined;
  let seconds = 0;
  for (const interval of sorted) {
    if (!active) active = { ...interval };
    else if (compareTimestamps(interval.start, active.end) <= 0) {
      if (compareTimestamps(interval.end, active.end) > 0)
        active.end = interval.end;
    } else {
      seconds += elapsedSeconds(active.start, active.end);
      active = { ...interval };
    }
  }
  if (active) seconds += elapsedSeconds(active.start, active.end);
  if (!Number.isFinite(seconds))
    throw new Error('Invalid summarized observation duration.');
  return seconds;
}
/** Retain only fixed-label union durations; unknown categories are excluded and explicitly disclosed. */
export function summarizeProviderSleep(
  records: readonly HealthObservation[],
  limitations: string[],
) {
  const stages = new Map<string, Interval[]>();
  const asleep: Interval[] = [];
  let lastEnd: string | null = null;
  for (const record of records) {
    const stage =
      record.value.kind === 'text' &&
      Object.hasOwn(sleepStages, record.value.text)
        ? sleepStages[record.value.text]
        : undefined;
    if (!stage) {
      limitations.push('unsupported_sleep_categories_excluded_from_duration');
      continue;
    }
    if (
      !record.endedAt ||
      compareTimestamps(record.effectiveAt, record.endedAt) >= 0
    ) {
      limitations.push(
        'missing_or_empty_sleep_interval_excluded_from_duration',
      );
      continue;
    }
    const interval = { start: record.effectiveAt, end: record.endedAt };
    const intervals = stages.get(stage) ?? [];
    intervals.push(interval);
    stages.set(stage, intervals);
    if (stage.startsWith('asleep')) asleep.push(interval);
    if (lastEnd === null || compareTimestamps(record.endedAt, lastEnd) > 0)
      lastEnd = record.endedAt;
  }
  const durations = Object.fromEntries(
    [...stages]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([stage, intervals]) => [stage, unionSeconds(intervals)]),
  );
  const asleepSeconds = unionSeconds(asleep);
  const stageTotal = Object.entries(durations).reduce(
    (sum, [stage, seconds]) => sum + (stage.startsWith('asleep') ? seconds : 0),
    0,
  );
  limitations.push('sleep_interval_union_is_not_complete_night_coverage');
  return {
    asleepSeconds,
    coveredThroughExclusive: lastEnd,
    overlappingStageSeconds: Math.max(0, stageTotal - asleepSeconds),
    stages: durations,
  };
}
