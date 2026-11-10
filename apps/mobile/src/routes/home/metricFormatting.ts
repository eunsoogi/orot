import { formatNumber, t, type TranslationKey } from '../../i18n';
import type { HomeMetric } from './metricSelection';

type HomeMetricUnitTranslationKey = Extract<
  TranslationKey,
  | 'home.metricUnit.minutes'
  | 'home.metricUnit.countPerMinute'
  | 'home.metricUnit.steps'
>;

// A unit is localized only when the metric and its canonical unit establish its meaning.
const localizedUnitKeys: Partial<
  Record<HomeMetric, Readonly<Record<string, HomeMetricUnitTranslationKey>>>
> = {
  sleep: { min: 'home.metricUnit.minutes' },
  heartRate: { 'count/min': 'home.metricUnit.countPerMinute' },
  steps: { count: 'home.metricUnit.steps' },
};

/** Returns the aggregate label associated with the selected metric. */
export function homeMetricStatistic(metric: HomeMetric): string {
  return {
    sleep: t('home.dailySum'),
    heartRate: t('home.dailyMean'),
    bodyMass: t('home.dailyLatest'),
    steps: t('home.dailySum'),
  }[metric];
}

/** Formats overview aggregates while preserving the source unit for unsupported pairs. */
export function formatHomeMetricValue(
  metric: HomeMetric,
  value: number,
  unit: string,
): string {
  const unitKeys = localizedUnitKeys[metric];
  // Inherited names such as "constructor" are not registered metric units.
  const unitKey =
    unitKeys && Object.hasOwn(unitKeys, unit) ? unitKeys[unit] : undefined;
  if (!unitKey)
    return `${formatNumber(value, { maximumFractionDigits: 1 })} ${unit}`;

  const wholeValue = metric === 'sleep' || metric === 'steps';
  const displayedValue = wholeValue ? Math.round(value) : value;
  const maximumFractionDigits = wholeValue ? 0 : 1;
  return `${formatNumber(displayedValue, { maximumFractionDigits })}${t(unitKey)}`;
}
