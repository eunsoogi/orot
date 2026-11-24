import { formatHealthDuration } from '../../i18n/healthDuration';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  t,
} from '../../i18n';
import { validChartRangePoint } from './chartRangeGeometry';
import type { ChartMetric, ChartPoint, ChartPresentation } from './types';

/** A date bucket is a calendar identity, not a UTC instant to shift by time zone. */
export function formatChartPosition(
  value: string,
  axis: 'time' | 'day',
): string {
  return axis === 'day' ? value : formatDateTime(new Date(value));
}

/** Compact daily ticks fit the plot while selected-point details retain the full date. */
export function formatChartTick(value: string, axis: 'time' | 'day'): string {
  return axis === 'day'
    ? value.slice(5).replace('-', '/')
    : formatChartPosition(value, axis);
}

/** Time ticks stay compact while selected-point details retain complete dates and times. */
export function formatChartTimeTick(value: number): string {
  const instant = new Date(value);
  return `${formatDate(instant, { month: 'numeric', day: 'numeric' })} ${formatTime(instant)}`;
}

/** Durations share overview rounding; other measurements retain their precision. */
export function formatChartValue(
  metric: ChartMetric,
  value: number,
  unit: string,
  presentation?: ChartPresentation,
): string {
  const duration = formatHealthDuration(metric, value, unit);
  if (duration !== undefined) return duration;
  const amount = formatNumber(
    value,
    usesWholeBpm(metric, unit, presentation)
      ? { maximumFractionDigits: 0 }
      : { maximumSignificantDigits: 21 },
  );
  if (metric === 'sleep' && unit === 'min')
    return `${amount}${t('overview.metricUnit.minutes')}`;
  if (metric === 'heartRate' && unit === 'count/min')
    return `${amount}${t('overview.metricUnit.countPerMinute')}`;
  if (metric === 'steps' && unit === 'count')
    return `${amount}${t('overview.metricUnit.steps')}`;
  return unit ? `${amount} ${unit}` : amount;
}

export function formatRangeAxisValue(value: number, wholeBpm: boolean): string {
  return formatNumber(value, { maximumFractionDigits: wholeBpm ? 0 : 1 });
}

export function usesWholeBpm(
  metric: ChartMetric,
  unit: string,
  presentation: ChartPresentation | undefined,
): boolean {
  return (
    (presentation === 'whole-bpm-overview' ||
      presentation === 'whole-bpm-derived-records') &&
    metric === 'heartRate' &&
    unit === 'count/min'
  );
}

/** Describe the sampled extrema and mean explicitly, not as a categorical low/high threshold. */
export function formatChartPointValue(
  metric: ChartMetric,
  point: ChartPoint,
  unit: string,
  presentation?: ChartPresentation,
): string {
  if (point.value === null) return t('chart.missing');
  if (!point.range)
    return formatChartValue(metric, point.value, unit, presentation);
  if (!validChartRangePoint(point)) return t('chart.missing');
  const value = (n: number) => formatChartValue(metric, n, unit, presentation);
  if (
    usesWholeBpm(metric, unit, presentation) &&
    point.range.samples > 1 &&
    point.range.minimum === point.range.maximum
  )
    return value(point.value);
  return point.range.samples === 1
    ? t('chart.singleSample', { value: value(point.value) })
    : t('chart.rangeAndMean', {
        minimum: value(point.range.minimum),
        maximum: value(point.range.maximum),
        mean: value(
          usesWholeBpm(metric, unit, presentation)
            ? point.value
            : Math.round(point.value * 10) / 10,
        ),
      });
}
