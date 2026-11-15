import type { OverviewMetric } from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';

const metricUnits: Record<OverviewMetric, string> = {
  sleep: 'min',
  heartRate: 'count/min',
  bodyMass: 'kg',
  steps: 'count',
  workouts: 'min',
};

/** Synthetic observations make the layout independent of stored health data. */
export function createMetric(metric: OverviewMetric): OverviewMetricProjection {
  return {
    metric,
    unit: metricUnits[metric],
    source: 'Watch',
    measuredAt: '2026-10-14T10:00:00Z',
    timeZone: 'UTC',
    latest: { date: '2026-10-14', value: 70 },
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-10-${String(index + 8).padStart(2, '0')}`,
      value: index + 1,
      partial: false,
    })),
    comparison: null,
  };
}

export function createComparedMetric(
  metric: OverviewMetric,
  previousCoverage: number,
  recentCoverage: number,
): OverviewMetricProjection {
  return {
    ...createMetric(metric),
    comparison: {
      previous: 420,
      recent: 450,
      previousCoverage,
      recentCoverage,
      previousDates: Array.from(
        { length: 7 },
        (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`,
      ),
      recentDates: Array.from(
        { length: 7 },
        (_, index) => `2026-10-${String(index + 8).padStart(2, '0')}`,
      ),
    },
  };
}
