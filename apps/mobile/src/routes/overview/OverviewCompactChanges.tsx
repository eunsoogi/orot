import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { AppSymbol } from '../../layout/AppSymbol';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { overviewMetricTitle } from './OverviewMetricCard';
import { formatOverviewMetricValue } from './metricFormatting';
import type { OverviewMetricProjection } from './metricProjection';
import {
  isOverviewSnapshotMetric,
  type OverviewMetric,
  type OverviewMetricChoice,
} from './metricSelection';
import { overviewMetricStyles as styles } from './overviewMetricStyles';

type MetricMap = Readonly<
  Partial<Record<OverviewMetric, OverviewMetricProjection>>
>;

/** Each visible widget supplies at most one existing, bounded comparison. */
function comparisonFor(choice: OverviewMetricChoice, metrics: MetricMap) {
  const keys: readonly OverviewMetric[] =
    choice === 'heartRate'
      ? ['restingHeartRate', 'heartRate', 'walkingHeartRate']
      : isOverviewSnapshotMetric(choice)
        ? [choice]
        : [];
  return keys
    .map(key => metrics[key])
    .find(
      metric =>
        metric?.comparison &&
        Number.isFinite(metric.comparison.recent) &&
        Number.isFinite(metric.comparison.previous),
    );
}

const symbols = {
  sleep: 'moon',
  heartRate: 'heart',
  restingHeartRate: 'heart',
  walkingHeartRate: 'heart',
  bodyMass: 'scalemass',
  steps: 'figure.walk',
  workouts: 'figure.run',
} as const;

/** Keeps recorded-day averages and partial coverage available without a second chart or card. */
export function OverviewCompactChanges({
  selected,
  metrics,
  available,
}: {
  readonly selected: readonly OverviewMetricChoice[];
  readonly metrics: MetricMap;
  readonly available: boolean;
}) {
  const rows = available
    ? selected.flatMap(choice => {
        const metric = comparisonFor(choice, metrics);
        return metric?.comparison
          ? [{ choice, metric, change: metric.comparison }]
          : [];
      })
    : [];
  return (
    <View style={compact.section} testID="overview-recent-changes-section">
      <View
        style={[styles.heading, compact.heading]}
        testID="overview-recent-changes-heading"
      >
        <Text
          accessibilityRole="header"
          style={styles.title}
          testID="overview-recent-changes"
        >
          {t('overview.recentChanges')}
        </Text>
        {rows.length > 0 ? (
          <Text style={compact.caption}>
            {t('overview.recentChangesPeriod')}
          </Text>
        ) : null}
      </View>
      <View style={styles.section} testID="overview-recent-changes-content">
        {rows.map(({ choice, metric, change }) => {
          const title = overviewMetricTitle(metric.metric);
          const value = (amount: number) =>
            formatOverviewMetricValue(metric.metric, amount, metric.unit);
          const delta = change.recent - change.previous;
          const displayDelta = value(Math.abs(delta));
          const movement =
            displayDelta === value(0)
              ? t('overview.recentChangesSame')
              : t(
                  delta > 0
                    ? 'overview.recentChangesUp'
                    : 'overview.recentChangesDown',
                  { amount: displayDelta },
                );
          const label = t('overview.recentChangesAverageFrom', {
            metric: title,
          });
          const detail = [
            `${label} ${movement}`,
            t('overview.comparisonPreviousPeriod'),
            `${change.previousDates[0]}–${change.previousDates.at(-1)}`,
            value(change.previous),
            t('overview.comparisonCoverage', {
              count: change.previousCoverage,
              total: change.previousDates.length,
            }),
            t('overview.comparisonRecentPeriod'),
            `${change.recentDates[0]}–${change.recentDates.at(-1)}`,
            value(change.recent),
            t('overview.comparisonCoverage', {
              count: change.recentCoverage,
              total: change.recentDates.length,
            }),
          ].join('. ');
          return (
            <View
              key={choice}
              accessible
              accessibilityRole="text"
              accessibilityLabel={detail}
              style={compact.row}
              testID={`overview-recent-change-${choice}`}
            >
              <AppSymbol
                name={symbols[metric.metric]}
                size={20}
                color={appColors.secondary}
              />
              <Text style={compact.sentence}>
                {label} <Text style={compact.change}>{movement}</Text>
              </Text>
            </View>
          );
        })}
        {available && rows.length === 0 ? (
          <Text>{t('overview.noChanges')}</Text>
        ) : null}
      </View>
    </View>
  );
}

const compact = StyleSheet.create({
  section: { gap: 4 },
  // This heading has no touch control. Keep its text reflow but not the
  // widgets' 44pt edit-button height, which leaves blank space below the title.
  heading: { minHeight: 0 },
  caption: { color: appColors.secondary, fontSize: 13, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  sentence: { flexShrink: 1, fontSize: 15, color: appColors.text },
  change: { fontWeight: '600' },
});
