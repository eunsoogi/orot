import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { formatHeartRateBpm } from '../../i18n/heartRateDisplay';
import { AppText as Text } from '../../layout/AppText';
import { overviewMetricStyles as styles } from './overviewMetricStyles';
import { useOverviewWorkoutPeriodHeartRate } from './useOverviewWorkoutPeriodHeartRate';

/** Shows the period mean directly, weighted by actual associated quantities, not workouts. */
export function OverviewWorkoutHeartRateCard({
  width,
  active,
  embedded,
}: {
  readonly width: number | undefined;
  readonly active: boolean;
  readonly embedded?: boolean;
}) {
  const state = useOverviewWorkoutPeriodHeartRate(active);
  return (
    <View
      style={[
        embedded ? styles.heartMetric : styles.card,
        { width: width ?? '100%' },
      ]}
      testID="overview-metric-workoutHeartRate"
    >
      <View style={embedded && embeddedStyles.readingLine}>
        <Text
          accessibilityRole="header"
          style={embedded ? styles.cardTitle : styles.title}
        >
          {t('healthRecords.workoutHeartRate.overviewTitle')}
        </Text>
        <Text
          style={
            embedded &&
            (state.status === 'available'
              ? styles.heartSupportingNumber
              : styles.detail)
          }
          accessibilityRole="status"
          accessibilityLabel={
            state.status === 'available'
              ? [
                  t('healthRecords.workoutHeartRate.associatedSource'),
                  formatHeartRateBpm(state.mean),
                ].join(', ')
              : undefined
          }
          testID="overview-workout-heart-rate-result"
        >
          {state.status === 'available'
            ? t('healthRecords.workoutHeartRate.periodAverage', {
                mean: formatHeartRateBpm(state.mean),
              })
            : state.status === 'loading'
              ? t('healthRecords.loading')
              : state.status === 'emptyVisible'
                ? t('healthRecords.workoutHeartRate.periodEmpty')
                : t('healthRecords.workoutHeartRate.periodUnavailable')}
        </Text>
      </View>
      <Text style={embedded && styles.detail}>
        {t('healthRecords.workoutHeartRate.periodLabel')}
      </Text>
    </View>
  );
}

const embeddedStyles = StyleSheet.create({
  readingLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: 8,
  },
});
