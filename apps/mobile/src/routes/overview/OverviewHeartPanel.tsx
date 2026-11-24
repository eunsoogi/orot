import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import type { OverviewMetricChoice } from './metricSelection';
import { overviewMetricStyles as overview } from './overviewMetricStyles';

type HeartChoice = Extract<
  OverviewMetricChoice,
  'heartRate' | 'restingHeartRate' | 'walkingHeartRate' | 'workoutHeartRate'
>;
type Card =
  | { kind: 'heart'; choices: readonly HeartChoice[] }
  | { kind: 'metric'; metric: Exclude<OverviewMetricChoice, HeartChoice> };

function isHeartChoice(metric: OverviewMetricChoice): metric is HeartChoice {
  return (
    metric === 'heartRate' ||
    metric === 'restingHeartRate' ||
    metric === 'walkingHeartRate' ||
    metric === 'workoutHeartRate'
  );
}

/** Group at the first selected heart slot. Do not rewrite preferences or enable an excluded metric. */
export function groupOverviewCardSelection(
  selection: readonly OverviewMetricChoice[],
): Card[] {
  const choices = selection.filter(isHeartChoice);
  return selection.flatMap<Card>(metric => {
    if (!isHeartChoice(metric)) return [{ kind: 'metric', metric }];
    return metric === choices[0] ? [{ kind: 'heart', choices }] : [];
  });
}

/** Only layout groups these readings. Each child keeps its own source, calendar
 * range, protection lifetime, chart gestures and VoiceOver points. */
export function OverviewHeartPanel({
  choices,
  width,
  measuredWidth,
  fontScale,
  renderMetric,
}: {
  readonly choices: readonly HeartChoice[];
  readonly width: number | '100%';
  readonly measuredWidth: number;
  readonly fontScale: number;
  readonly renderMetric: (
    metric: HeartChoice,
    placement: 'featured' | 'supporting',
  ) => ReactNode;
}) {
  const featured = choices.includes('heartRate');
  const supporting = choices.filter(item => item !== 'heartRate');
  // Reserve each chart's full readable width and preserve ordered reading/interaction.
  const sideBySide =
    supporting.length > 1 && measuredWidth >= 680 * Math.max(1, fontScale);
  const subrowWidth = sideBySide ? (measuredWidth - 28 - 12) / 2 : '100%';
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
      {featured ? renderMetric('heartRate', 'featured') : null}
      {supporting.length ? (
        <View
          testID="overview-heart-subrows"
          style={[styles.subrows, sideBySide && styles.sideBySide]}
        >
          {supporting.map(metric => (
            <View key={metric} style={{ width: subrowWidth }}>
              {renderMetric(metric, 'supporting')}
            </View>
          ))}
        </View>
      ) : null}
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
  subrows: { width: '100%', flexDirection: 'column', gap: 12 },
  sideBySide: { flexDirection: 'row', flexWrap: 'wrap' },
});
