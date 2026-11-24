import { useState } from 'react';
import { View } from 'react-native';
import { ChartPlot } from '../../ui/charts';
import { workoutRecordsChartKind } from '../../ui/charts/workoutRecordsChart';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { formatDateTime, t } from '../../i18n';
import type { ChartData, ChartStatus } from '../../ui/charts';
import { isOverviewHeartRate, type OverviewMetric } from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';
import { overviewMetricStyles as styles } from './overviewMetricStyles';
import {
  overviewMetricChartData,
  overviewMetricChartPlaceholderData,
} from './overviewMetricChart';
import {
  formatOverviewMetricValue,
  overviewMetricStatistic,
} from './metricFormatting';

export const overviewMetricTitle = (metric: OverviewMetric) =>
  ({
    sleep: t('overview.metricSleep'),
    heartRate: t('overview.metricHeartRate'),
    restingHeartRate: t('healthkit.commonObservations.restingHeartRate'),
    walkingHeartRate: t('healthkit.commonObservations.walkingHeartRateAverage'),
    bodyMass: t('overview.metricBodyMass'),
    steps: t('overview.metricSteps'),
    workouts: t('healthRecords.category.workouts'),
  })[metric];

type HeartPlacement = 'featured' | 'supporting';

const overviewMetricAccent = (metric: OverviewMetric) =>
  ({
    sleep: appColors.purple,
    heartRate: appColors.pink,
    restingHeartRate: appColors.pink,
    walkingHeartRate: appColors.pink,
    bodyMass: appColors.primaryText,
    steps: appColors.green,
    workouts: appColors.green,
  })[metric];

const overviewMetricSymbol = (metric: OverviewMetric) =>
  ({
    sleep: 'moon',
    heartRate: 'heart',
    restingHeartRate: 'heart',
    walkingHeartRate: 'heart',
    bodyMass: 'scalemass',
    steps: 'figure.walk',
    workouts: 'figure.run',
  })[metric];

/** Keeps metric identity visible in both loaded cards and reserved chart placeholders. */
function OverviewMetricHeading({
  metric,
  quiet,
}: {
  readonly metric: OverviewMetric;
  readonly quiet?: boolean;
}) {
  return (
    <View style={styles.metricHeading}>
      {!quiet && (
        <View style={styles.metricIcon}>
          <AppSymbol
            name={overviewMetricSymbol(metric)}
            color={overviewMetricAccent(metric)}
          />
        </View>
      )}
      <Text style={styles.cardTitle}>{overviewMetricTitle(metric)}</Text>
    </View>
  );
}

/** Uses local calendar bars so daily buckets do not become instants on a timezone-aware line axis. */
function MeasuredOverviewMetricChart({
  metric,
  data,
}: {
  readonly metric: OverviewMetric;
  readonly data: ChartData;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  return (
    <View
      style={styles.chart}
      testID={`overview-metric-chart-container-${metric}`}
      onLayout={event => {
        const measuredWidth = event.nativeEvent.layout.width;
        setChartWidth(current =>
          current === measuredWidth ? current : measuredWidth,
        );
      }}
    >
      <ChartPlot
        data={data}
        compact
        hideDetails
        barTooltip
        height={176}
        lineAxis="day"
        kind={workoutRecordsChartKind(
          metric,
          isOverviewHeartRate(metric) ? 'range' : 'line',
        )}
        testID={`overview-metric-chart-${metric}`}
        title={t('overview.metricChartTitle')}
        width={chartWidth}
      />
    </View>
  );
}

/** Groups only the headline summary so chart values, guidance, and controls stay independently accessible. */
export function OverviewMetricCard({
  metric,
  width,
  chartStatus,
  heartPlacement,
}: {
  readonly metric: OverviewMetricProjection;
  readonly width: number | '100%';
  readonly chartStatus?: Extract<ChartStatus, 'loading' | 'stale'>;
  readonly heartPlacement?: HeartPlacement;
}) {
  const chartData = overviewMetricChartData(metric, chartStatus);
  const statistic = overviewMetricStatistic(metric.metric);
  const latestValue = formatOverviewMetricValue(
    metric.metric,
    metric.latest.value,
    metric.unit,
  );
  const accessibilityLabel = [
    overviewMetricTitle(metric.metric),
    `${metric.latest.date} ${statistic}: ${latestValue}`,
    metric.measuredAt
      ? formatDateTime(new Date(metric.measuredAt))
      : t('overview.measurementUnknown'),
  ].join('. ');
  return (
    <View
      style={[
        heartPlacement ? styles.heartMetric : styles.card,
        styles.gridCard,
        { width },
      ]}
      testID={`overview-metric-${metric.metric}`}
    >
      <View
        style={styles.metricSummary}
        testID={`overview-metric-summary-${metric.metric}`}
        accessibilityLabel={accessibilityLabel}
        accessible
      >
        <OverviewMetricHeading
          metric={metric.metric}
          quiet={Boolean(heartPlacement)}
        />
        <Text
          style={[
            styles.number,
            heartPlacement === 'featured' && styles.heartNumber,
            heartPlacement === 'supporting' && styles.heartSupportingNumber,
          ]}
        >
          {latestValue}
        </Text>
        <Text style={styles.detail}>
          {metric.latest.date} · {statistic}
        </Text>
        <Text style={styles.detail}>
          {metric.measuredAt
            ? formatDateTime(new Date(metric.measuredAt))
            : t('overview.measurementUnknown')}
        </Text>
      </View>
      <MeasuredOverviewMetricChart metric={metric.metric} data={chartData} />
    </View>
  );
}

/** Keeps the chart frame stable while leaving chart status and empty guidance accessible. */
export function OverviewMetricChartPlaceholder({
  metric,
  width,
  status,
  emptyMessage,
  heartPlacement,
}: {
  readonly metric: OverviewMetric;
  readonly width: number | '100%';
  readonly status: Extract<
    ChartStatus,
    'loading' | 'stale' | 'error' | 'empty'
  >;
  readonly emptyMessage?: string;
  readonly heartPlacement?: HeartPlacement;
}) {
  return (
    <View
      style={[
        heartPlacement ? styles.heartMetric : styles.card,
        styles.gridCard,
        { width },
      ]}
      testID={`overview-metric-${metric}`}
    >
      <View
        style={styles.metricSummary}
        testID={`overview-metric-summary-${metric}`}
        accessibilityLabel={overviewMetricTitle(metric)}
        accessible
      >
        <OverviewMetricHeading
          metric={metric}
          quiet={Boolean(heartPlacement)}
        />
      </View>
      {/* Keep the chart's vertical position stable while local metric values are unavailable. */}
      <Text style={styles.number}>{'\u00a0'}</Text>
      <Text style={styles.detail}>{'\u00a0'}</Text>
      <Text style={styles.detail}>{'\u00a0'}</Text>
      <MeasuredOverviewMetricChart
        metric={metric}
        data={overviewMetricChartPlaceholderData(metric, status)}
      />
      {emptyMessage && <Text style={styles.detail}>{emptyMessage}</Text>}
    </View>
  );
}
