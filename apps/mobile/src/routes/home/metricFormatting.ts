import { formatNumber, t, type TranslationKey } from '../../i18n';
import type { HomeMetric } from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';

type HomeMetricUnitTranslationKey = Extract<
  TranslationKey,
  | 'home.metricUnit.minutes'
  | 'home.metricUnit.countPerMinute'
  | 'home.metricUnit.steps'
>;

// Unit meaning depends on both the metric and its canonical source unit.
// Unrecognized pairs retain the source label instead of borrowing another meaning.
const localizedUnitKeys: Partial<
  Record<HomeMetric, Readonly<Record<string, HomeMetricUnitTranslationKey>>>
> = {
  sleep: { min: 'home.metricUnit.minutes' },
  heartRate: { 'count/min': 'home.metricUnit.countPerMinute' },
  steps: { count: 'home.metricUnit.steps' },
};

/** Returns the Korean overview title for the selected health metric. */
export function homeMetricTitle(metric: HomeMetric): string {
  return {
    sleep: t('home.metricSleep'),
    heartRate: t('home.metricHeartRate'),
    bodyMass: t('home.metricBodyMass'),
    steps: t('home.metricSteps'),
  }[metric];
}

/** Returns the Korean statistic label used by overview and comparison cards. */
export function homeMetricStatistic(metric: HomeMetric): string {
  return {
    sleep: t('home.dailySum'),
    heartRate: t('home.dailyMean'),
    bodyMass: t('home.dailyLatest'),
    steps: t('home.dailySum'),
  }[metric];
}

/** Formats chart-day labels while retaining empty and partial-day context for VoiceOver. */
export function formatHomeMetricDaySummary(
  metric: HomeMetricProjection,
): string {
  return metric.days
    .map(
      day =>
        `${day.date}: ${day.value === null ? t('home.metricEmpty') : formatHomeMetricValue(metric.metric, day.value, metric.unit)}${day.partial ? `, ${t('home.partialToday')}` : ''}`,
    )
    .join('; ');
}

/** Formats Home aggregates for Korean display without changing projected or stored values. */
export function formatHomeMetricValue(
  metric: HomeMetric,
  value: number,
  unit: string,
): string {
  const unitKeys = localizedUnitKeys[metric];
  // Inherited names such as "constructor" do not establish a metric unit meaning.
  const unitKey =
    unitKeys && Object.hasOwn(unitKeys, unit) ? unitKeys[unit] : undefined;
  if (!unitKey)
    return `${formatNumber(value, { maximumFractionDigits: 1 })} ${unit}`;

  const wholeValue = metric === 'sleep' || metric === 'steps';
  const displayedValue = wholeValue ? Math.round(value) : value;
  return `${formatNumber(displayedValue, { maximumFractionDigits: wholeValue ? 0 : 1 })}${t(unitKey)}`;
}
