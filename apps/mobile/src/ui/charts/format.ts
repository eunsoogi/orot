import { formatHealthDuration } from '../../i18n/healthDuration';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  t,
} from '../../i18n';
import type { ChartMetric } from './types';

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
): string {
  const duration = formatHealthDuration(metric, value, unit);
  if (duration !== undefined) return duration;
  const amount = formatNumber(value, { maximumSignificantDigits: 21 });
  if (metric === 'sleep' && unit === 'min')
    return `${amount}${t('overview.metricUnit.minutes')}`;
  if (metric === 'heartRate' && unit === 'count/min')
    return `${amount}${t('overview.metricUnit.countPerMinute')}`;
  if (metric === 'steps' && unit === 'count')
    return `${amount}${t('overview.metricUnit.steps')}`;
  return unit ? `${amount} ${unit}` : amount;
}
