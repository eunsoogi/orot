import type { OverviewSleepEpisode } from './overviewSleepEpisode';
import type { OverviewChartHealthContext } from '../../healthEvidence/healthContext/healthContextReport';
import type { ChartRange } from '../../ui/charts/types';
import { compareHealthKitTimestamps } from '../../healthkit/commonObservations/time';
import { isOverviewHeartRate, type OverviewMetric } from './metricSelection';

export interface OverviewMetricDay {
  readonly date: string;
  readonly value: number | null;
  readonly partial: boolean;
  readonly range?: ChartRange;
}
export interface OverviewMetricProjection {
  readonly metric: OverviewMetric;
  readonly sleepEpisode?: OverviewSleepEpisode;
  readonly unit: string;
  readonly source: string;
  readonly measuredAt: string | null;
  readonly latest: { readonly date: string; readonly value: number };
  readonly timeZone: string;
  readonly days: readonly OverviewMetricDay[];
  readonly comparison: {
    readonly previous: number;
    readonly recent: number;
    readonly previousCoverage: number;
    readonly recentCoverage: number;
    readonly previousDates: readonly string[];
    readonly recentDates: readonly string[];
  } | null;
}

/** Keep every tile and its source label bound to the same quantity series. */
export function selectOverviewQuantitySeries(
  report: OverviewChartHealthContext,
  metric: OverviewMetric,
  concept: string,
  unit: string,
) {
  const matches = report.quantities.filter(
    item => item.concept === concept && item.unit === unit,
  );
  if (metric !== 'workouts') return matches[0];

  // The most frequently used tracker is not necessarily the last workout's
  // source. Use the newest actual sample without pooling overlapping sources.
  return matches.reduce<(typeof matches)[number] | undefined>(
    (chosen, item) => {
      const newest = item.days.at(-1)?.lastAt;
      const previous = chosen?.days.at(-1)?.lastAt;
      return newest &&
        (!previous || compareHealthKitTimestamps(newest, previous) > 0)
        ? item
        : chosen;
    },
    undefined,
  );
}

/** Uses one sensor series throughout; absent dates remain gaps and partial today is excluded from comparison. */
export function projectOverviewMetric(
  report: OverviewChartHealthContext,
  metric: OverviewMetric,
  sourceName: string,
  sleepMeasuredAt: string | null = null,
): OverviewMetricProjection | null {
  const concept = {
    heartRate: 'heart_rate',
    restingHeartRate: 'resting_heart_rate',
    walkingHeartRate: 'walking_heart_rate_average',
    bodyMass: 'body_mass',
    steps: 'step_count',
    workouts: 'workout_duration',
  } as const;
  const unit = {
    sleep: 'min',
    heartRate: 'count/min',
    restingHeartRate: 'count/min',
    walkingHeartRate: 'count/min',
    bodyMass: 'kg',
    steps: 'count',
    workouts: 'min',
  } as const;
  const series =
    metric === 'sleep'
      ? undefined
      : selectOverviewQuantitySeries(
          report,
          metric,
          concept[metric],
          unit[metric],
        );
  if (metric !== 'sleep' && !series) return null;
  const values = new Map<string, number>();
  const comparisonValues = new Map<string, number>();
  const heartRanges = new Map<string, ChartRange>();
  if (metric === 'sleep') {
    for (const day of report.sleep)
      if (day.asleepSeconds > 0) {
        values.set(day.date, day.asleepSeconds / 60);
        comparisonValues.set(day.date, day.asleepSeconds / 60);
      }
  } else {
    for (const day of series!.days) {
      // The range and mean must describe the exact same admitted daily sensor samples.
      if (isOverviewHeartRate(metric))
        heartRanges.set(day.date, {
          minimum: day.minimum,
          maximum: day.maximum,
          samples: day.samples,
        });
      values.set(
        day.date,
        metric === 'steps' || metric === 'workouts'
          ? day.sum
          : metric === 'bodyMass'
            ? day.latest
            : day.mean,
      );
      comparisonValues.set(
        day.date,
        metric === 'steps' || metric === 'workouts' ? day.sum : day.mean,
      );
    }
  }
  if (!values.size) return null;
  const complete = report.days.filter(day => !day.partial);
  const windowValues = (days: typeof complete) =>
    days.flatMap(day =>
      comparisonValues.has(day.date) ? [comparisonValues.get(day.date)!] : [],
    );
  const previous = windowValues(complete.slice(-14, -7));
  const recent = windowValues(complete.slice(-7));
  const mean = (items: number[]) =>
    items.reduce((sum, value) => sum + value, 0) / items.length;
  const comparable =
    complete.length >= 14 &&
    previous.length > 0 &&
    recent.length > 0 &&
    !report.limitations.includes('quantity_sensor_series_limit_reached');
  const currentParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: report.window.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(report.window.toExclusive));
  const part = (name: string) =>
    currentParts.find(item => item.type === name)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const chartDays =
    report.days.at(-1)?.date === today
      ? report.days
      : [...report.days, { date: today, partial: true }];
  return {
    metric,
    unit: unit[metric],
    source: sourceName,
    latest: {
      date: [...values.keys()].sort().at(-1)!,
      value: values.get([...values.keys()].sort().at(-1)!)!,
    },
    timeZone: report.window.timeZone,
    measuredAt:
      metric === 'sleep'
        ? sleepMeasuredAt
        : (series!.days.at(-1)?.lastAt ?? null),
    days: chartDays.slice(-7).map(day => ({
      date: day.date,
      value: values.get(day.date) ?? null,
      partial: day.partial,
      ...(heartRanges.has(day.date)
        ? { range: heartRanges.get(day.date) }
        : {}),
    })),
    comparison: comparable
      ? {
          previous: mean(previous),
          recent: mean(recent),
          previousCoverage: previous.length,
          recentCoverage: recent.length,
          previousDates: complete.slice(-14, -7).map(day => day.date),
          recentDates: complete.slice(-7).map(day => day.date),
        }
      : null,
  };
}
