import { t } from '../../i18n';
import type { ChartData, ChartStatus } from '../../ui/charts';
import type { OverviewMetricProjection } from './metricProjection';

/** Keeps the selected series' day buckets while generic source labels preserve Home's existing privacy. */
export function overviewMetricChartData(
  metric: OverviewMetricProjection,
  status?: ChartStatus,
): ChartData {
  const points = metric.days.map(day => ({
    x: day.date,
    value:
      day.value === null
        ? null
        : chartValueForDisplay(metric.metric, day.value, metric.unit),
    source: t('overview.metricChartSource'),
    ...(day.partial ? { partial: true } : {}),
  }));
  const recordedDays = points.filter(point => point.value !== null).length;
  const hasPartialCoverage =
    recordedDays < points.length || points.some(point => point.partial);

  return {
    metric: metric.metric,
    coverage: {
      requested: t('overview.metricChartWindow'),
      displayed: t('overview.metricChartCoverage', {
        recorded: recordedDays,
        total: points.length,
      }),
      status:
        status ??
        (recordedDays === 0
          ? 'empty'
          : hasPartialCoverage
            ? 'partial'
            : 'ready'),
    },
    series: [
      {
        id: metric.metric,
        label: t('overview.metricChartDailySeries'),
        unit: metric.unit,
        style: 'primary',
        points,
      },
    ],
  };
}

/** Supplies an empty daily series while Home is loading, has no history, or reports a read failure. */
export function overviewMetricChartPlaceholderData(
  metric: OverviewMetricProjection['metric'],
  status: Extract<ChartStatus, 'loading' | 'stale' | 'error' | 'empty'>,
): ChartData {
  return {
    metric,
    coverage: {
      requested: t('overview.metricChartWindow'),
      displayed: t('overview.metricChartCoverage', { recorded: 0, total: 7 }),
      status,
    },
    series: [],
  };
}

/** Match Home's established display precision without mutating the source projection. */
function chartValueForDisplay(
  metric: OverviewMetricProjection['metric'],
  value: number,
  unit: string,
): number {
  if (
    (metric === 'sleep' && unit === 'min') ||
    (metric === 'steps' && unit === 'count')
  ) {
    return Math.round(value);
  }
  if (
    (metric === 'heartRate' && unit === 'count/min') ||
    (metric === 'bodyMass' && unit === 'kg')
  ) {
    return Math.round(value * 10) / 10;
  }
  return value;
}
