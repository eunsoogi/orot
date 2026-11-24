import { View } from 'react-native';
import { formatNumber, t } from '../../i18n';
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
      <Text accessibilityRole="header" style={styles.title}>
        {t('healthRecords.workoutHeartRate.overviewTitle')}
      </Text>
      <Text>{t('healthRecords.workoutHeartRate.periodLabel')}</Text>
      <Text
        accessibilityRole="status"
        testID="overview-workout-heart-rate-result"
      >
        {state.status === 'available'
          ? t('healthRecords.workoutHeartRate.periodAverage', {
              mean: formatNumber(state.mean, { maximumFractionDigits: 0 }),
            })
          : state.status === 'loading'
            ? t('healthRecords.loading')
            : t('healthRecords.workoutHeartRate.periodUnavailable')}
      </Text>
    </View>
  );
}
