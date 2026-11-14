import { formatHealthDuration } from '../../i18n/healthDuration';
import { formatNumber, t, type TranslationKey } from '../../i18n';
import type { OverviewMetric } from './metricSelection';

type OverviewMetricUnitTranslationKey = Extract<
  TranslationKey,
  | 'overview.metricUnit.minutes'
  | 'overview.metricUnit.countPerMinute'
  | 'overview.metricUnit.steps'
>;

// A unit is localized only when the metric and its canonical unit establish its meaning.
const localizedUnitKeys: Partial<
  Record<
    OverviewMetric,
    Readonly<Record<string, OverviewMetricUnitTranslationKey>>
  >
> = {
  sleep: { min: 'overview.metricUnit.minutes' },
  heartRate: { 'count/min': 'overview.metricUnit.countPerMinute' },
  steps: { count: 'overview.metricUnit.steps' },
};

/** Returns the aggregate label associated with the selected metric. */
export function overviewMetricStatistic(metric: OverviewMetric): string {
  return {
    sleep: t('overview.dailySum'),
    heartRate: t('overview.dailyMean'),
    bodyMass: t('overview.dailyLatest'),
    steps: t('overview.dailySum'),
  }[metric];
}

/** Formats overview aggregates while preserving the source unit for unsupported pairs. */
export function formatOverviewMetricValue(
  metric: OverviewMetric,
  value: number,
  unit: string,
): string {
  const duration = formatHealthDuration(metric, value, unit);
  if (duration !== undefined) return duration;
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
