export type OverviewSleepStage =
  'awake' | 'rem' | 'core' | 'deep' | 'unspecified';
export type SleepInterval = {
  stage: OverviewSleepStage;
  start: number;
  end: number;
};
export type SourcedSleepInterval = SleepInterval & { source: string };
export type OverviewSleepEpisode = {
  readonly from: number;
  readonly to: number;
  readonly asleepMinutes: number;
  readonly intervals: readonly SleepInterval[];
};

const sessionBreak = 90 * 60_000;
const order = ['awake', 'rem', 'core', 'deep', 'unspecified'] as const;
export const overviewSleepStages = order;
const stages: Readonly<Record<string, OverviewSleepStage>> = {
  '1': 'unspecified',
  asleepUnspecified: 'unspecified',
  '2': 'awake',
  awake: 'awake',
  '3': 'core',
  asleepCore: 'core',
  '4': 'deep',
  asleepDeep: 'deep',
  '5': 'rem',
  asleepREM: 'rem',
};

export function overviewSleepStage(
  code: string,
): OverviewSleepStage | undefined {
  return Object.prototype.hasOwnProperty.call(stages, code)
    ? stages[code]
    : undefined;
}

function union(intervals: readonly SleepInterval[]) {
  const merged: Array<{ start: number; end: number }> = [];
  for (const point of [...intervals].sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1);
    if (previous && point.start <= previous.end)
      previous.end = Math.max(previous.end, point.end);
    else merged.push({ start: point.start, end: point.end });
  }
  return merged;
}

/** Find the latest observed asleep episode of a single source. Long separations
 * split episodes; short gaps remain blank and never count as sleep or awake.
 * Per-stage unions deduplicate repeats without inventing a preferred stage when
 * the originating sensor provided conflicting labels. */
export function projectLatestSleepEpisode(
  input: readonly SourcedSleepInterval[],
): OverviewSleepEpisode | undefined {
  const bySource = new Map<string, SleepInterval[]>();
  for (const { source, stage, start, end } of input) {
    if (
      !source ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      continue;
    const items = bySource.get(source) ?? [];
    items.push({ stage, start, end });
    bySource.set(source, items);
  }
  let latest: OverviewSleepEpisode | undefined;
  for (const source of [...bySource.keys()].sort()) {
    const samples = bySource.get(source)!;
    const asleep = union(
      samples.filter(interval => interval.stage !== 'awake'),
    );
    const last = asleep.at(-1);
    if (!last || (latest && last.end < latest.to)) continue;
    let first = asleep.length - 1;
    while (
      first > 0 &&
      asleep[first]!.start - asleep[first - 1]!.end <= sessionBreak
    )
      first -= 1;
    const from = asleep[first]!.start;
    const to = last.end;
    const asleepMinutes =
      asleep.slice(first).reduce((n, item) => n + item.end - item.start, 0) /
      60_000;
    const clipped = samples.flatMap(sample => {
      const start = Math.max(sample.start, from);
      const end = Math.min(sample.end, to);
      return end > start ? [{ stage: sample.stage, start, end }] : [];
    });
    const intervals = order
      .flatMap(stage =>
        union(clipped.filter(point => point.stage === stage)).map(point => ({
          ...point,
          stage,
        })),
      )
      .sort((a, b) => a.start - b.start || a.end - b.end);
    if (latest && latest.to === to && latest.asleepMinutes >= asleepMinutes)
      continue;
    latest = {
      from,
      to,
      asleepMinutes,
      intervals: intervals.some(
        point => point.stage !== 'awake' && point.stage !== 'unspecified',
      )
        ? intervals
        : [],
    };
  }
  return latest;
}

/** Connect only an unambiguous change at the same observed instant. The episode is
 * ordered by start time; earlier overlapping observations must not imply a stage switch. */
export function sleepStageTransitions({ intervals }: OverviewSleepEpisode) {
  let earlierEnd = -Infinity;
  return intervals.flatMap((interval, index) => {
    const next = intervals[index + 1];
    const singlyLinked =
      interval.end === next?.start &&
      earlierEnd < interval.end &&
      intervals[index + 2]?.start !== next.start;
    earlierEnd = Math.max(earlierEnd, interval.end);
    return singlyLinked && next.stage !== interval.stage
      ? [{ from: interval.stage, to: next.stage, at: interval.end }]
      : [];
  });
}
