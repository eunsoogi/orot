import { t } from '../../i18n';
import type { ChartData, ChartSeries, ChartStatus } from '../../ui/charts';
import { summarizeSparseHeartRates } from '../../ui/charts/summarizeSparseHeartRates';
import {
  isOverviewDerivedHeartRate,
  isOverviewHeartRate,
} from './metricSelection';
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
        : isOverviewHeartRate(metric.metric) && metric.unit === 'count/min'
          ? day.value
          : chartValueForDisplay(metric.metric, day.value, metric.unit),
    source: t('overview.metricChartSource'),
    ...(isOverviewHeartRate(metric.metric) && day.range
      ? { range: day.range }
      : {}),
    ...(day.partial ? { partial: true } : {}),
  }));
  const recordedDays = points.filter(point => point.value !== null).length;
  const hasPartialCoverage =
    recordedDays < points.length || points.some(point => point.partial);

  const series: ChartSeries[] = [
    {
      id: metric.metric,
      label: t('overview.metricChartDailySeries'),
      unit: metric.unit,
      style: 'primary',
      points,
    },
  ];
  const displayed =
    isOverviewDerivedHeartRate(metric.metric) && metric.unit === 'count/min'
      ? summarizeSparseHeartRates(series)
      : series;
  return {
    metric: chartMetric(metric.metric),
    ...(isOverviewHeartRate(metric.metric) && metric.unit === 'count/min'
      ? { presentation: 'whole-bpm-overview' as const }
      : {}),
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
    series: displayed.map(item =>
      item.points.some(point => point.period)
        ? { ...item, label: t('chart.groupedMean') }
        : item,
    ),
  };
}

/** Supplies an empty daily series while Home is loading, has no history, or reports a read failure. */
export function overviewMetricChartPlaceholderData(
  metric: OverviewMetricProjection['metric'],
  status: Extract<ChartStatus, 'loading' | 'stale' | 'error' | 'empty'>,
): ChartData {
  return {
    metric: chartMetric(metric),
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
  if (metric === 'bodyMass' && unit === 'kg') {
    return Math.round(value * 10) / 10;
  }
  return value;
}

/** The renderer shares BPM formatting; the card and point series retain their own metric IDs. */
function chartMetric(
  metric: OverviewMetricProjection['metric'],
): ChartData['metric'] {
  return metric === 'restingHeartRate' || metric === 'walkingHeartRate'
    ? 'heartRate'
    : metric;
}
