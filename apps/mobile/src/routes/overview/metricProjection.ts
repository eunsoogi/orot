import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import type { OverviewMetric } from './metricSelection';

export interface OverviewMetricDay {
  readonly date: string;
  readonly value: number | null;
  readonly partial: boolean;
}
export interface OverviewMetricProjection {
  readonly metric: OverviewMetric;
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

/** Uses one sensor series throughout; absent dates remain gaps and partial today is excluded from comparison. */
export function projectOverviewMetric(
  report: HealthContextReport,
  metric: OverviewMetric,
  sourceName: string,
  sleepMeasuredAt: string | null = null,
): OverviewMetricProjection | null {
  const concept = {
    heartRate: 'heart_rate',
    bodyMass: 'body_mass',
    steps: 'step_count',
    workouts: 'workout_duration',
  } as const;
  const unit = {
    sleep: 'min',
    heartRate: 'count/min',
    bodyMass: 'kg',
    steps: 'count',
    workouts: 'min',
  } as const;
  const series =
    metric === 'sleep'
      ? undefined
      : report.quantities.find(
          item =>
            item.concept === concept[metric] && item.unit === unit[metric],
        );
  if (metric !== 'sleep' && !series) return null;
  const values = new Map<string, number>();
  const comparisonValues = new Map<string, number>();
  if (metric === 'sleep') {
    for (const day of report.sleep)
      if (day.asleepSeconds > 0) {
        values.set(day.date, day.asleepSeconds / 60);
        comparisonValues.set(day.date, day.asleepSeconds / 60);
      }
  } else {
    for (const day of series!.days) {
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
