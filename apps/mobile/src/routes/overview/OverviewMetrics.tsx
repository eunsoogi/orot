import { Fragment, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppButton } from '../../layout/AppButton';
import { t } from '../../i18n';
import type { ChartStatus } from '../../ui/charts';
import {
  isOverviewSnapshotMetric,
  type OverviewMetricChoice,
} from './metricSelection';
import { useOverviewMetrics } from './useOverviewMetrics';
import { overviewMetricStyles as styles } from './overviewMetricStyles';
import {
  OverviewMetricCard,
  OverviewMetricChartPlaceholder,
  overviewMetricTitle as title,
} from './OverviewMetricCard';
import {
  resolveOverviewMetricGridLayout,
  resolveOverviewRecentChangeLayout,
} from './overviewMetricLayout';
import { OverviewRecentHealthChange } from './OverviewRecentHealthChange';
import { formatOverviewMetricValue } from './metricFormatting';
import {
  OverviewHeartPanel,
  groupOverviewCardSelection,
} from './OverviewHeartPanel';
/** Shows saved calendar-day metrics; an isolated route owns uncommitted edits. */
export function OverviewMetrics({ onEdit }: { readonly onEdit?: () => void }) {
  const data = useOverviewMetrics();
  const { fontScale } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const comparisons = data.selection
    .filter(isOverviewSnapshotMetric)
    .flatMap(metric =>
      data.metrics[metric]?.comparison ? [data.metrics[metric]!] : [],
    )
    .slice(0, 2);
  const cards = groupOverviewCardSelection(data.selection);
  const gridLayout = resolveOverviewMetricGridLayout(
    gridWidth,
    cards.length,
    fontScale,
  );
  const recentChangeLayout = resolveOverviewRecentChangeLayout(
    gridWidth,
    fontScale,
  );
  const placeholderStatus: Extract<
    ChartStatus,
    'loading' | 'stale' | 'error' | 'empty'
  > =
    data.state === 'loading' || data.state === 'refreshing'
      ? 'loading'
      : data.state === 'failed'
        ? 'error'
        : data.state === 'stale'
          ? 'stale'
          : 'empty';
  const chartStatus =
    data.state === 'refreshing'
      ? 'loading'
      : data.state === 'stale'
        ? 'stale'
        : undefined;
  const metricCard = (
    metric: Exclude<OverviewMetricChoice, 'workoutHeartRate'>,
    width: number | '100%',
  ) => {
    return data.metrics[metric] ? (
      <OverviewMetricCard
        metric={data.metrics[metric]!}
        width={width}
        chartStatus={chartStatus}
      />
    ) : (
      <OverviewMetricChartPlaceholder
        metric={metric}
        status={placeholderStatus}
        width={width}
        emptyMessage={
          data.state === 'ready'
            ? metric !== 'sleep' && data.quantityTruncated
              ? t('overview.metricTruncated')
              : t('overview.metricWindowEmpty')
            : undefined
        }
      />
    );
  };
  const canShowComparisons =
    data.state === 'ready' ||
    data.state === 'refreshing' ||
    data.state === 'stale';
  return (
    <View style={styles.sections} testID="overview-health-sections">
      <View style={styles.section} testID="overview-health-overview-section">
        <View style={styles.heading} testID="overview-health-overview-heading">
          <Text accessibilityRole="header" style={styles.title}>
            {t('overview.healthOverview')}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="overview-metrics-edit"
            style={styles.edit}
            disabled={data.state !== 'ready' || !onEdit}
            accessibilityState={{ disabled: data.state !== 'ready' || !onEdit }}
            onPress={onEdit}
          >
            <Text>{t('overview.metricEdit')}</Text>
          </Pressable>
        </View>
        {data.state === 'failed' ? (
          <>
            <Text accessibilityRole="alert">{t('overview.metricError')}</Text>
            <AppButton title={t('appointments.retry')} onPress={data.retry} />
          </>
        ) : null}
        {data.state === 'stale' && (
          <>
            <Text accessibilityRole="alert">{t('overview.metricStale')}</Text>
            <AppButton title={t('appointments.retry')} onPress={data.retry} />
          </>
        )}
        <View
          style={styles.grid}
          testID="overview-metric-grid"
          onLayout={event => {
            const { width } = event.nativeEvent.layout;
            setGridWidth(current => (current === width ? current : width));
          }}
        >
          {cards.map(metric =>
            metric === 'heartRate' ? (
              <OverviewHeartPanel
                key={metric}
                width={gridLayout.cardWidth}
                metrics={data.metrics}
                workoutSelectionEpoch={data.workoutSelectionEpoch}
                preserveWorkoutOwner={data.preserveWorkoutOwner}
                state={data.state}
              />
            ) : isOverviewSnapshotMetric(metric) ? (
              <Fragment key={metric}>
                {metricCard(metric, gridLayout.cardWidth)}
              </Fragment>
            ) : null,
          )}
        </View>
      </View>
      <View style={styles.section} testID="overview-recent-changes-section">
        <View style={styles.heading} testID="overview-recent-changes-heading">
          <Text
            accessibilityRole="header"
            style={styles.title}
            testID="overview-recent-changes"
          >
            {t('overview.recentChanges')}
          </Text>
        </View>
        <View style={styles.section} testID="overview-recent-changes-content">
          {canShowComparisons &&
            (comparisons.length ? (
              comparisons.map(metric => (
                <OverviewRecentHealthChange
                  key={metric.metric}
                  metric={metric}
                  title={title(metric.metric)}
                  layout={recentChangeLayout}
                  formatValue={(amount, unit) =>
                    formatOverviewMetricValue(metric.metric, amount, unit)
                  }
                />
              ))
            ) : (
              <Text>{t('overview.noChanges')}</Text>
            ))}
        </View>
      </View>
    </View>
  );
}
