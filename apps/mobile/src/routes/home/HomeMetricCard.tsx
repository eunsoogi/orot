import { useState } from 'react';
import { View } from 'react-native';
import { ChartPlot } from '../../ui/charts';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { formatDateTime, t } from '../../i18n';
import type { ChartData, ChartStatus } from '../../ui/charts';
import type { HomeMetric } from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';
import { homeMetricStyles as styles } from './homeMetricStyles';
import {
  homeMetricChartData,
  homeMetricChartPlaceholderData,
} from './homeMetricChart';
import {
  formatHomeMetricDaySummary,
  formatHomeMetricValue,
  homeMetricStatistic,
} from './metricFormatting';

export const homeMetricTitle = (metric: HomeMetric) =>
  ({
    sleep: t('home.metricSleep'),
    heartRate: t('home.metricHeartRate'),
    bodyMass: t('home.metricBodyMass'),
    steps: t('home.metricSteps'),
  })[metric];

const homeMetricAccent = (metric: HomeMetric) =>
  ({
    sleep: appColors.purple,
    heartRate: appColors.pink,
    bodyMass: appColors.primaryText,
    steps: appColors.green,
  })[metric];

const homeMetricSymbol = (metric: HomeMetric) =>
  ({
    sleep: 'moon',
    heartRate: 'heart',
    bodyMass: 'scalemass',
    steps: 'figure.walk',
  })[metric];

/** Keeps metric identity visible in both loaded cards and reserved chart placeholders. */
function HomeMetricHeading({ metric }: { readonly metric: HomeMetric }) {
  return (
    <View style={styles.metricHeading}>
      <View style={styles.metricIcon}>
        <AppSymbol
          name={homeMetricSymbol(metric)}
          color={homeMetricAccent(metric)}
        />
      </View>
      <Text style={styles.cardTitle}>{homeMetricTitle(metric)}</Text>
    </View>
  );
}

/** Uses local calendar bars so daily buckets do not become instants on a timezone-aware line axis. */
function MeasuredHomeMetricChart({
  metric,
  data,
}: {
  readonly metric: HomeMetric;
  readonly data: ChartData;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  return (
    <View
      style={styles.chart}
      testID={`home-metric-chart-container-${metric}`}
      onLayout={event => {
        const measuredWidth = event.nativeEvent.layout.width;
        setChartWidth(current =>
          current === measuredWidth ? current : measuredWidth,
        );
      }}
    >
      <ChartPlot
        data={data}
        height={112}
        kind="bar"
        testID={`home-metric-chart-${metric}`}
        title={t('home.metricChartTitle')}
        width={chartWidth}
      />
    </View>
  );
}

/** Renders a metric with the shared daily chart while keeping source and time-zone metadata private. */
export function HomeMetricCard({
  metric,
  width,
  chartStatus,
}: {
  readonly metric: HomeMetricProjection;
  readonly width: number | '100%';
  readonly chartStatus?: Extract<ChartStatus, 'loading' | 'stale'>;
}) {
  const chartData = homeMetricChartData(metric, chartStatus);
  const statistic = homeMetricStatistic(metric.metric);
  const latestValue = formatHomeMetricValue(
    metric.metric,
    metric.latest.value,
    metric.unit,
  );
  const summary = formatHomeMetricDaySummary(metric);
  const accessibilityLabel = [
    homeMetricTitle(metric.metric),
    `${metric.latest.date} ${statistic}: ${latestValue}`,
    metric.measuredAt
      ? formatDateTime(new Date(metric.measuredAt))
      : t('home.measurementUnknown'),
    summary,
    ...(chartStatus ? [t(`chart.state.${chartStatus}`)] : []),
  ].join('. ');
  return (
    <View
      style={[styles.card, styles.gridCard, { width }]}
      testID={`home-metric-${metric.metric}`}
      accessibilityLabel={accessibilityLabel}
      accessible
    >
      <HomeMetricHeading metric={metric.metric} />
      <Text style={styles.number}>{latestValue}</Text>
      <Text style={styles.detail}>
        {metric.latest.date} · {statistic}
      </Text>
      <Text style={styles.detail}>
        {metric.measuredAt
          ? formatDateTime(new Date(metric.measuredAt))
          : t('home.measurementUnknown')}
      </Text>
      <MeasuredHomeMetricChart metric={metric.metric} data={chartData} />
      {metric.days.at(-1)?.partial && (
        <Text style={styles.detail}>{t('home.partialToday')}</Text>
      )}
    </View>
  );
}

/** Keeps the chart frame in place until Home has a usable local snapshot. */
export function HomeMetricChartPlaceholder({
  metric,
  width,
  status,
  emptyMessage,
}: {
  readonly metric: HomeMetric;
  readonly width: number | '100%';
  readonly status: Extract<
    ChartStatus,
    'loading' | 'stale' | 'error' | 'empty'
  >;
  readonly emptyMessage?: string;
}) {
  const accessibilityLabel = `${homeMetricTitle(metric)}. ${t(`chart.state.${status}`)}`;
  return (
    <View
      style={[styles.card, styles.gridCard, { width }]}
      testID={`home-metric-${metric}`}
      accessibilityLabel={accessibilityLabel}
      accessible
    >
      <HomeMetricHeading metric={metric} />
      {/* Keep the chart's vertical position stable while local metric values are unavailable. */}
      <Text style={styles.number}>{'\u00a0'}</Text>
      <Text style={styles.detail}>{'\u00a0'}</Text>
      <Text style={styles.detail}>{'\u00a0'}</Text>
      <MeasuredHomeMetricChart
        metric={metric}
        data={homeMetricChartPlaceholderData(metric, status)}
      />
      {emptyMessage && <Text style={styles.detail}>{emptyMessage}</Text>}
    </View>
  );
}
