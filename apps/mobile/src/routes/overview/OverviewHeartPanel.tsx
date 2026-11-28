import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { OverviewReadingValue } from './OverviewReadingValue';
import { OverviewReadingSkeleton } from './OverviewReadingSkeleton';
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

import { useOverviewHeartFirstLayout } from './useOverviewHeartFirstLayout';

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
  focused = false,
}: {
  readonly metric: HeartReading;
  readonly focused?: boolean;
  readonly value?: OverviewMetricProjection;
  readonly state: State;
}) {
  const primary = metric === 'heartRate';
  const onTextLayout = useOverviewHeartFirstLayout(
    'ordinary',
    primary && focused,
    !!value && state === 'ready',
  );
  const range =
    primary && value?.days.find(day => day.date === value.latest.date)?.range;

  const amount = value
    ? formatOverviewMetricValue(metric, value.latest.value, value.unit)
    : unavailable(state);

  // Keep the actual daily period and source available without adding extra visual rows.
  const context =
    value &&
    [
      title(metric),
      amount,
      value.latest.date,
      t('chart.source', { source: value.source }),
      ...(range && range.minimum !== range.maximum
        ? [
            t('overview.heartPanelRange', {
              minimum: isHeartRateDisplayUnit(value.unit)
                ? formatHeartRateBpm(range.minimum, false)
                : formatOverviewMetricValue(metric, range.minimum, value.unit),
              maximum: formatOverviewMetricValue(
                metric,
                range.maximum,
                value.unit,
              ),
            }),
          ]
        : []),
    ].join(', ');

  return (
    <View
      testID={`overview-metric-${metric}`}
      style={primary ? styles.featured : styles.subrow}
    >
      <View style={!primary && styles.readingLine}>
        {!primary && (
          <Text style={overview.widgetRowTitle}>{title(metric)}</Text>
        )}
        {!value && state === 'loading' ? (
          <OverviewReadingSkeleton
            metric={metric}
            large={primary}
            label={amount}
          />
        ) : (
          <Text
            onTextLayout={onTextLayout}
            accessibilityLabel={context}
            style={
              value
                ? primary
                  ? overview.heartNumber
                  : overview.heartSupportingNumber
                : overview.detail
            }
          >
            {primary && value ? (
              <OverviewReadingValue formatted={amount} />
            ) : (
              amount
            )}
          </Text>
        )}
      </View>
    </View>
  );
}

function HeartPanelRule() {
  return <View style={styles.rule} pointerEvents="none" />;
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
  return (
    <View
      style={[
        overview.card,
        overview.widgetShell,
        overview.gridCard,
        styles.panel,
        { width },
      ]}
      testID="overview-heart-panel"
    >
      <View style={styles.heading}>
        <AppSymbol name="heart" color={appColors.secondary} />
        <Text accessibilityRole="header" style={overview.widgetTitle}>
          {t('overview.heartPanel')}
        </Text>
      </View>
      <HeartReadingValue
        metric="heartRate"
        focused={focused}
        value={metrics.heartRate}
        state={state}
      />
      <View testID="overview-heart-subrows" style={styles.subrows}>
        <HeartPanelRule />
        <HeartReadingValue
          metric="restingHeartRate"
          value={metrics.restingHeartRate}
          state={state}
        />
        <HeartPanelRule />
        <HeartReadingValue
          metric="walkingHeartRate"
          value={metrics.walkingHeartRate}
          state={state}
        />
        <HeartPanelRule />
        <OverviewWorkoutHeartRateCard
          width={undefined}
          active={focused}
          readSavedSelection
          embedded
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 9 },
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
  subrows: { width: '100%', gap: 7 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: appColors.border },
});
