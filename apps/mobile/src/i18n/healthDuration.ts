import { formatNumber, t } from './index';

/** Display-only rounding: round total minutes once, then split so the remainder
 * never reaches 60. Only established sleep/min and workouts/min pairs opt in; rates and unknown
 * units keep their existing format. Invalid durations are left to the caller. */
export function formatHealthDuration(
  metric: string,
  value: number,
  unit: string,
): string | undefined {
  if (
    (metric !== 'sleep' && metric !== 'workouts') ||
    unit !== 'min' ||
    !Number.isFinite(value) ||
    value < 0
  )
    return undefined;
  const minutes = Math.round(value);
  const amount = (number: number) =>
    formatNumber(number, { maximumFractionDigits: 0 });
  return minutes < 60
    ? `${amount(minutes)}${t('overview.metricUnit.minutes')}`
    : t('overview.duration.hoursMinutes', {
        hours: amount(Math.floor(minutes / 60)),
        minutes: amount(minutes % 60),
      });
}
