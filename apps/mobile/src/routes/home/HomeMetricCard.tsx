import { View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { formatDateTime, formatNumber, t } from '../../i18n';
import type { HomeMetric } from './metricSelection';
import type { HomeMetricProjection } from './metricProjection';
import { homeMetricStyles as styles } from './homeMetricStyles';

export const homeMetricTitle = (metric: HomeMetric) =>
  ({
    sleep: t('home.metricSleep'),
    heartRate: t('home.metricHeartRate'),
    bodyMass: t('home.metricBodyMass'),
    steps: t('home.metricSteps'),
  })[metric];

export const homeMetricValue = (number: number, unit: string) =>
  `${formatNumber(number, { maximumFractionDigits: 1 })} ${unit}`;

/** Renders one metric and its seven-day chart at the width measured by its parent grid. */
export function HomeMetricCard({
  metric,
  width,
}: {
  readonly metric: HomeMetricProjection;
  readonly width: number | '100%';
}) {
  const accent =
    metric.metric === 'sleep'
      ? appColors.purple
      : metric.metric === 'heartRate'
        ? appColors.pink
        : metric.metric === 'bodyMass'
          ? appColors.primaryText
          : appColors.green;
  const symbol = {
    sleep: 'moon',
    heartRate: 'heart',
    bodyMass: 'scalemass',
    steps: 'figure.walk',
  }[metric.metric];
  const maximum = Math.max(1, ...metric.days.map(day => day.value ?? 0));
  const statistic =
    metric.metric === 'heartRate'
      ? t('home.dailyMean')
      : metric.metric === 'bodyMass'
        ? t('home.dailyLatest')
        : t('home.dailySum');
  const summary = metric.days
    .map(
      day =>
        `${day.date}: ${day.value === null ? t('home.metricEmpty') : homeMetricValue(day.value, metric.unit)}${day.partial ? `, ${t('home.partialToday')}` : ''}`,
    )
    .join('; ');
  return (
    <View
      style={[styles.card, styles.gridCard, { width }]}
      testID={`home-metric-${metric.metric}`}
      accessibilityLabel={`${homeMetricTitle(metric.metric)}. ${metric.latest.date} ${statistic}: ${homeMetricValue(metric.latest.value, metric.unit)}. ${metric.measuredAt ? formatDateTime(new Date(metric.measuredAt)) : t('home.measurementUnknown')}. ${metric.source}. ${metric.timeZone}. ${summary}`}
      accessible
    >
      <View style={styles.metricHeading}>
        <View style={styles.metricIcon}>
          <AppSymbol name={symbol} color={accent} />
        </View>
        <Text style={styles.cardTitle}>{homeMetricTitle(metric.metric)}</Text>
      </View>
      <Text style={styles.number}>
        {homeMetricValue(metric.latest.value, metric.unit)}
      </Text>
      <Text style={styles.detail}>
        {metric.latest.date} · {statistic}
      </Text>
      <Text style={styles.detail}>
        {metric.measuredAt
          ? formatDateTime(new Date(metric.measuredAt))
          : t('home.measurementUnknown')}{' '}
        · {metric.source} · {metric.timeZone}
      </Text>
      <Text style={styles.detail}>
        0 – {homeMetricValue(maximum, metric.unit)}
      </Text>
      <View style={styles.chart} testID={`home-metric-chart-${metric.metric}`}>
        {metric.days.map(day => (
          <View key={day.date} style={styles.column}>
            <View style={styles.barSpace}>
              {day.value !== null && (
                <View
                  style={[
                    styles.bar,
                    { backgroundColor: accent },
                    { height: `${(day.value / maximum) * 100}%` },
                  ]}
                />
              )}
            </View>
            <Text style={styles.date}>
              {day.date.slice(5).replace('-', '/')}
            </Text>
          </View>
        ))}
      </View>
      {metric.days.at(-1)?.partial && (
        <Text style={styles.detail}>{t('home.partialToday')}</Text>
      )}
    </View>
  );
}
