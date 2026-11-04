import { View } from 'react-native';
import { t } from '../../i18n';
import { AppText as Text } from '../../layout/AppText';
import { homeMetricStyles as styles } from './homeMetricStyles';
import type { HomeMetricProjection } from './metricProjection';

interface ComparisonPeriod {
  readonly label: string;
  readonly dateRange: string;
  readonly value: string;
  readonly recordedDays: number;
  readonly totalDays: number;
}

interface Props {
  readonly metric: HomeMetricProjection;
  readonly title: string;
  // Keep unit formatting in the Home route so the comparison block follows its metric-specific contract.
  readonly formatValue: (amount: number, unit: string) => string;
}

const coverage = ({ recordedDays, totalDays }: ComparisonPeriod) =>
  t('home.comparisonCoverage', { count: recordedDays, total: totalDays });

/** Keeps period values distinct in visual and spoken order while omitting source and time-zone metadata. */
export function HomeRecentHealthChange({ metric, title, formatValue }: Props) {
  // Non-null comparisons have both complete seven-day windows, even when their coverage differs.
  const comparison = metric.comparison;
  if (!comparison) return null;

  const previousDates = comparison.previousDates;
  const recentDates = comparison.recentDates;
  const previous: ComparisonPeriod = {
    label: t('home.comparisonPreviousPeriod'),
    dateRange: `${previousDates[0]}–${previousDates.at(-1)}`,
    value: formatValue(comparison.previous, metric.unit),
    recordedDays: comparison.previousCoverage,
    totalDays: previousDates.length,
  };
  const recent: ComparisonPeriod = {
    label: t('home.comparisonRecentPeriod'),
    dateRange: `${recentDates[0]}–${recentDates.at(-1)}`,
    value: formatValue(comparison.recent, metric.unit),
    recordedDays: comparison.recentCoverage,
    totalDays: recentDates.length,
  };
  const statistic = t('home.recordedDayMean');
  const accessibilityLabel = [
    title,
    statistic,
    previous.label,
    previous.dateRange,
    previous.value,
    coverage(previous),
    recent.label,
    recent.dateRange,
    recent.value,
    coverage(recent),
  ].join('. ');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, styles.recentChange]}
      testID={`home-recent-change-${metric.metric}`}
    >
      <Text style={styles.comparisonTitle}>{title}</Text>
      <Text style={styles.comparisonStatistic}>{statistic}</Text>
      {[previous, recent].map(period => (
        <View key={period.label} style={styles.comparisonPeriod}>
          <Text style={styles.comparisonPeriodLabel}>{period.label}</Text>
          <Text style={styles.comparisonDateRange}>{period.dateRange}</Text>
          <Text style={styles.comparisonValue}>{period.value}</Text>
          <Text style={styles.comparisonCoverage}>{coverage(period)}</Text>
        </View>
      ))}
    </View>
  );
}
