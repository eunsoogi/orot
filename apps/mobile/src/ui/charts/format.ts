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

/** The axis uses shorter local labels; the adjacent values retain full dates and times. */
export function formatChartTimeTick(value: number): string {
  const instant = new Date(value);
  return `${formatDate(instant, { month: 'numeric', day: 'numeric' })} ${formatTime(instant)}`;
}

/** Format actual values without imposing metric-specific rounding or precision. */
export function formatChartValue(
  metric: ChartMetric,
  value: number,
  unit: string,
): string {
  const amount = formatNumber(value, { maximumSignificantDigits: 21 });
  if (metric === 'sleep' && unit === 'min')
    return `${amount}${t('home.metricUnit.minutes')}`;
  if (metric === 'heartRate' && unit === 'count/min')
    return `${amount}${t('home.metricUnit.countPerMinute')}`;
  if (metric === 'steps' && unit === 'count')
    return `${amount}${t('home.metricUnit.steps')}`;
  return unit ? `${amount} ${unit}` : amount;
}
