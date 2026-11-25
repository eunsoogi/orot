import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import {
  formatHeartRateBpm,
  isHeartRateDisplayUnit,
} from '../../i18n/heartRateDisplay';
import {
  coalesceOverviewHeartSelection,
  type OverviewMetricChoice,
} from './metricSelection';
import type { OverviewMetricProjection } from './metricProjection';
import { formatOverviewMetricValue } from './metricFormatting';
import { OverviewWorkoutHeartRateCard } from './OverviewWorkoutHeartRateCard';
import { overviewMetricStyles as overview } from './overviewMetricStyles';

export function groupOverviewCardSelection(
  selection: readonly OverviewMetricChoice[],
) {
  return coalesceOverviewHeartSelection(selection);
}

type HeartReading = 'heartRate' | 'restingHeartRate' | 'walkingHeartRate';
type State = 'loading' | 'ready' | 'refreshing' | 'stale' | 'failed';

function title(metric: HeartReading) {
  switch (metric) {
    case 'heartRate':
      return t('overview.metricHeartRate');
    case 'restingHeartRate':
      return t('healthkit.commonObservations.restingHeartRate');
    case 'walkingHeartRate':
      return t('healthkit.commonObservations.walkingHeartRateAverage');
  }
}
function unavailable(state: State) {
  if (state === 'failed') return t('overview.metricError');
  if (state === 'loading' || state === 'refreshing')
    return t('healthRecords.loading');
  return t('overview.metricEmpty');
}

function HeartReadingValue({
  metric,
  value,
  state,
}: {
  readonly metric: HeartReading;
  readonly value?: OverviewMetricProjection;
  readonly state: State;
}) {
  const primary = metric === 'heartRate';
  const range =
    primary && value?.days.find(day => day.date === value.latest.date)?.range;

  const amount = value
    ? formatOverviewMetricValue(metric, value.latest.value, value.unit)
    : unavailable(state);

  return (
    <View
      testID={`overview-metric-${metric}`}
      style={primary ? styles.featured : styles.subrow}
    >
      <View style={!primary && styles.readingLine}>
        <Text style={overview.cardTitle}>{title(metric)}</Text>
        <Text
          accessibilityLabel={
            value
              ? [amount, t('chart.source', { source: value.source })].join(', ')
              : undefined
          }
          style={
            value
              ? primary
                ? overview.heartNumber
                : overview.heartSupportingNumber
              : overview.detail
          }
        >
          {amount}
        </Text>
      </View>
      {value ? <Text style={overview.detail}>{value.latest.date}</Text> : null}
      {value && range && range.minimum !== range.maximum ? (
        <Text style={overview.detail}>
          {t('overview.heartPanelRange', {
            minimum: isHeartRateDisplayUnit(value.unit)
              ? formatHeartRateBpm(range.minimum, false)
              : formatOverviewMetricValue(metric, range.minimum, value.unit),
            maximum: formatOverviewMetricValue(
              metric,
              range.maximum,
              value.unit,
            ),
          })}
        </Text>
      ) : null}
    </View>
  );
}

/** Each compact text reading keeps its own metric and original period; no charts or mixed sources. */
export function OverviewHeartPanel({
  width,
  metrics,
  state,
}: {
  readonly width: number | '100%';
  readonly metrics: Partial<Record<HeartReading, OverviewMetricProjection>>;
  readonly state: State;
}) {
  const focused = useIsFocused();
  // The provisional default selection is not authority for a native workout read.
  const active =
    focused &&
    (state === 'ready' || state === 'refreshing' || state === 'stale');
  return (
    <View
      style={[overview.card, overview.gridCard, styles.panel, { width }]}
      testID="overview-heart-panel"
    >
      <View style={styles.heading}>
        <AppSymbol name="heart" color={appColors.pink} />
        <Text accessibilityRole="header" style={overview.title}>
          {t('overview.heartPanel')}
        </Text>
      </View>
      <HeartReadingValue
        metric="heartRate"
        value={metrics.heartRate}
        state={state}
      />
      <View testID="overview-heart-subrows" style={styles.subrows}>
        <HeartReadingValue
          metric="restingHeartRate"
          value={metrics.restingHeartRate}
          state={state}
        />
        <HeartReadingValue
          metric="walkingHeartRate"
          value={metrics.walkingHeartRate}
          state={state}
        />
        <OverviewWorkoutHeartRateCard
          width={undefined}
          active={active}
          embedded
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 14 },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  featured: { gap: 4 },
  subrow: { gap: 3 },
  readingLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  subrows: { width: '100%', gap: 12 },
});
