import { View } from 'react-native';
import { t } from '../../i18n';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import type { HomeRecentChangeLayout } from './homeMetricLayout';
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
  readonly layout?: HomeRecentChangeLayout;
  // Keep unit formatting in the Home route so the comparison block follows its metric-specific contract.
  readonly formatValue: (amount: number, unit: string) => string;
}

const coverage = ({ recordedDays, totalDays }: ComparisonPeriod) =>
  t('home.comparisonCoverage', { count: recordedDays, total: totalDays });

/** Keeps previous and recent periods distinct while omitting source and time-zone metadata. */
export function HomeRecentHealthChange({
  metric,
  title,
  layout = 'row',
  formatValue,
}: Props) {
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
  const symbol = {
    sleep: 'bed.double',
    heartRate: 'heart',
    bodyMass: 'scalemass',
    steps: 'figure.walk',
  }[metric.metric];
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
      style={[
        styles.card,
        styles.recentChange,
        layout === 'row' ? styles.recentChangeRow : styles.recentChangeStacked,
      ]}
      testID={`home-recent-change-${metric.metric}`}
    >
      <View
        style={[
          styles.comparisonIdentity,
          layout !== 'row' && styles.comparisonIdentityFull,
        ]}
        testID={`home-recent-change-identity-${metric.metric}`}
      >
        <AppSymbol name={symbol} size={18} color={appColors.secondary} />
        <Text style={styles.comparisonTitle}>{title}</Text>
      </View>
      {layout !== 'column' ? (
        <>
          {layout === 'row' ? <View style={styles.comparisonDivider} /> : null}
          <View
            style={styles.comparisonPeriods}
            testID={`home-recent-change-periods-${metric.metric}`}
          >
            <View style={styles.comparisonPeriod}>
              <Text style={styles.comparisonValue}>{previous.value}</Text>
              <View style={styles.comparisonSummary}>
                <Text style={styles.comparisonSummaryLabel}>
                  {previous.label}
                </Text>
                <Text style={styles.comparisonSummaryCoverage}>
                  {t('home.comparisonRowCoverage', {
                    count: previous.recordedDays,
                  })}
                </Text>
              </View>
            </View>
            <Text style={styles.comparisonArrow} accessible={false}>
              →
            </Text>
            <View style={styles.comparisonPeriod}>
              <Text style={styles.comparisonValue}>{recent.value}</Text>
              <View style={styles.comparisonSummary}>
                <Text style={styles.comparisonSummaryLabel}>
                  {recent.label}
                </Text>
                <Text style={styles.comparisonSummaryCoverage}>
                  {t('home.comparisonRowCoverage', {
                    count: recent.recordedDays,
                  })}
                </Text>
              </View>
            </View>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.comparisonStatistic}>{statistic}</Text>
          <View style={styles.comparisonPeriodsStacked}>
            {[previous, recent].map(period => (
              <View
                key={period.label}
                style={[
                  styles.comparisonPeriod,
                  styles.comparisonPeriodStacked,
                ]}
              >
                <Text style={styles.comparisonPeriodLabel}>{period.label}</Text>
                <Text style={styles.comparisonDateRange}>
                  {period.dateRange}
                </Text>
                <Text style={styles.comparisonValue}>{period.value}</Text>
                <Text style={styles.comparisonCoverage}>
                  {coverage(period)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
