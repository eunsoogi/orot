import { SleepImportError } from './errors';
import type {
  AsleepStage,
  SleepDaySummary,
  SleepObservation,
  SleepStage,
  SleepSummaryRange,
} from './types';
import {
  dayFromOrdinal,
  dayOrdinal,
  localDayAt,
  localDayFormatter,
  nextLocalDayBoundary,
} from './summaryCalendar';

const asleepStages: readonly AsleepStage[] = [
  'asleepUnspecified',
  'asleepCore',
  'asleepDeep',
  'asleepREM',
];

interface DayWork {
  readonly sampleIds: Set<string>;
  readonly inBed: Array<{ start: number; end: number }>;
  readonly stages: Array<{
    start: number;
    end: number;
    stage: SleepStage;
  }>;
}

export function summarizeSleepByDay(
  observations: readonly SleepObservation[],
  range: SleepSummaryRange,
): readonly SleepDaySummary[] {
  const fromOrdinal = dayOrdinal(range.fromDay);
  const throughOrdinal = dayOrdinal(range.throughDay);
  if (fromOrdinal > throughOrdinal) {
    throw new SleepImportError(
      'INVALID_SLEEP_DAY_RANGE',
      'The first local day must not follow the last local day.',
    );
  }
  const formatter = localDayFormatter(range.timeZone);
  const summaries = new Map<string, DayWork>();
  for (let ordinal = fromOrdinal; ordinal <= throughOrdinal; ordinal += 1) {
    const day = dayFromOrdinal(ordinal);
    summaries.set(day, { sampleIds: new Set(), inBed: [], stages: [] });
  }

  for (const observation of observations) {
    splitObservationByLocalDay(observation, formatter, summaries);
  }
  return [...summaries].map(([localDate, work]) =>
    summarizeDay(localDate, range.timeZone, work),
  );
}

function splitObservationByLocalDay(
  observation: SleepObservation,
  formatter: Intl.DateTimeFormat,
  summaries: Map<string, DayWork>,
): void {
  if (
    !Number.isFinite(observation.startEpochMs) ||
    !Number.isFinite(observation.endEpochMs) ||
    observation.startEpochMs >= observation.endEpochMs
  ) {
    throw new SleepImportError(
      'INVALID_SLEEP_INTERVAL',
      'A sleep summary needs valid positive-length intervals.',
    );
  }
  let cursor = observation.startEpochMs;
  while (cursor < observation.endEpochMs) {
    const localDate = localDayAt(cursor, formatter);
    const next = nextLocalDayBoundary(
      cursor,
      observation.endEpochMs,
      localDate,
      formatter,
    );
    if (next <= cursor) {
      throw new SleepImportError(
        'INVALID_SLEEP_INTERVAL',
        'A sleep interval could not be split at a local-day boundary.',
      );
    }
    const day = summaries.get(localDate);
    if (day) {
      day.sampleIds.add(observation.id);
      const interval = { start: cursor, end: next };
      if (observation.stage === 'inBed') {
        day.inBed.push(interval);
      } else {
        day.stages.push({
          ...interval,
          stage: observation.stage,
        });
      }
    }
    cursor = next;
  }
}

function summarizeDay(
  localDate: string,
  timeZone: string,
  work: DayWork,
): SleepDaySummary {
  const stageDurationMs: Record<AsleepStage, number> = {
    asleepUnspecified: 0,
    asleepCore: 0,
    asleepDeep: 0,
    asleepREM: 0,
  };
  let awakeDurationMs = 0;
  let unclassifiedDurationMs = 0;
  for (const segment of exclusiveSegments(work.stages)) {
    const duration = segment.end - segment.start;
    if (isAsleepStage(segment.stage))
      stageDurationMs[segment.stage] += duration;
    else if (segment.stage === 'awake') awakeDurationMs += duration;
    else if (segment.stage === 'unsupported')
      unclassifiedDurationMs += duration;
  }
  const asleepDurationMs = asleepStages.reduce(
    (sum, stage) => sum + stageDurationMs[stage],
    0,
  );
  return {
    localDate,
    timeZone,
    status: work.sampleIds.size === 0 ? 'noData' : 'observed',
    sampleCount: work.sampleIds.size,
    inBedDurationMs: unionDuration(work.inBed),
    asleepDurationMs,
    awakeDurationMs,
    unclassifiedDurationMs,
    stageDurationMs,
  };
}

function exclusiveSegments(
  intervals: DayWork['stages'],
): Array<{ start: number; end: number; stage: SleepStage }> {
  const boundaries = [
    ...new Set(intervals.flatMap(item => [item.start, item.end])),
  ].sort((left, right) => left - right);
  const result: Array<{ start: number; end: number; stage: SleepStage }> = [];
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (start === undefined || end === undefined || start === end) continue;
    let winner: DayWork['stages'][number] | undefined;
    for (const interval of intervals) {
      if (
        interval.start <= start &&
        interval.end >= end &&
        (!winner || stagePriority(interval.stage) < stagePriority(winner.stage))
      ) {
        winner = interval;
      }
    }
    if (winner) result.push({ start, end, stage: winner.stage });
  }
  return result;
}

function stagePriority(stage: SleepStage): number {
  // A fixed stage order resolves conflicts; equal-priority samples yield the same summary value.
  switch (stage) {
    case 'awake':
      return 0;
    case 'asleepDeep':
      return 1;
    case 'asleepREM':
      return 2;
    case 'asleepCore':
      return 3;
    case 'asleepUnspecified':
      return 4;
    case 'unsupported':
      return 5;
    case 'inBed':
      return 6;
  }
}

function unionDuration(
  intervals: readonly { start: number; end: number }[],
): number {
  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let total = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const interval of sorted) {
    if (start === undefined || end === undefined || interval.start > end) {
      if (start !== undefined && end !== undefined) total += end - start;
      start = interval.start;
      end = interval.end;
    } else {
      end = Math.max(end, interval.end);
    }
  }
  return start === undefined || end === undefined ? total : total + end - start;
}

function isAsleepStage(stage: SleepStage): stage is AsleepStage {
  return stage !== 'inBed' && stage !== 'awake' && stage !== 'unsupported';
}
