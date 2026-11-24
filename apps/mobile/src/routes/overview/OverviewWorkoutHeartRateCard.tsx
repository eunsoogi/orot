import { View } from 'react-native';
import { formatNumber, t } from '../../i18n';
import { AppButton } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { formatRecordedAt } from '../../recording/formatRecordedAt';
import { provenanceLabel } from '../../healthkit/healthRecordsDetailPresentation';
import { workoutActivityLabel } from '../../healthkit/workoutPresentation';
import { overviewMetricStyles as styles } from './overviewMetricStyles';
import type { OverviewWorkoutCandidate } from './overviewWorkoutHeartRateSource';
import { useOverviewWorkoutHeartRate } from './useOverviewWorkoutHeartRate';

function datedWorkout({ record }: OverviewWorkoutCandidate) {
  return (
    workoutActivityLabel(record) + ' · ' + formatRecordedAt(record.effectiveAt)
  );
}

function amount(value: number) {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/** This association-only card does not participate in multi-day Overview aggregates. */
export function OverviewWorkoutHeartRateCard({
  width,
  active,
}: {
  readonly width: number | undefined;
  readonly active: boolean;
}) {
  const { state, choose, select } = useOverviewWorkoutHeartRate(active);
  const busy = state.status === 'loading' || state.status === 'reading';
  return (
    <View
      style={[styles.card, { width: width ?? '100%' }]}
      testID="overview-metric-workoutHeartRate"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t('healthRecords.workoutHeartRate.overviewTitle')}
      </Text>
      <Text>{t('healthRecords.workoutHeartRate.scope')}</Text>
      <AppButton
        disabled={!active || busy}
        title={t('healthRecords.workoutHeartRate.choose')}
        testID="overview-workout-heart-rate-choose"
        onPress={choose}
        variant="secondary"
      />
      {state.status === 'loading' ? (
        <Text accessibilityRole="status">{t('healthRecords.loading')}</Text>
      ) : null}
      {state.status === 'choosing' ? (
        <>
          {state.candidates.map((candidate, index) => (
            <AppButton
              key={candidate.record.id}
              title={datedWorkout(candidate)}
              accessibilityHint={t('healthRecords.workoutHeartRate.check')}
              testID={`overview-workout-heart-rate-option-${index}`}
              onPress={() => select(candidate)}
              variant="secondary"
            />
          ))}
          {!state.candidates.length ? (
            <Text accessibilityRole="status">
              {t('healthRecords.workoutHeartRate.empty')}
            </Text>
          ) : null}
          {state.hasMore ? (
            <Text>{t('healthRecords.moreAvailable')}</Text>
          ) : null}
        </>
      ) : null}
      {state.status === 'reading' || state.status === 'result' ? (
        <>
          <Text>{datedWorkout(state.selection)}</Text>
          <Text>
            {t('healthRecords.workoutHeartRate.window', {
              start: formatRecordedAt(state.selection.record.effectiveAt),
              end: formatRecordedAt(state.selection.record.endedAt!),
            })}
          </Text>
          <Text>
            {t('healthRecords.workoutHeartRate.workoutSource', {
              source: provenanceLabel(state.selection.record),
            })}
          </Text>
          <Text
            accessibilityRole="status"
            testID="overview-workout-heart-rate-result"
          >
            {state.status === 'reading'
              ? t('healthRecords.workoutHeartRate.reading')
              : state.result.status === 'available'
                ? t('healthRecords.workoutHeartRate.summary', {
                    minimum: amount(state.result.minimum),
                    mean: amount(state.result.mean),
                    maximum: amount(state.result.maximum),
                  })
                : t('healthRecords.workoutHeartRate.notAvailable')}
          </Text>
        </>
      ) : null}
      {state.status === 'failed' ? (
        <Text accessibilityRole="alert">
          {t('healthRecords.workoutHeartRate.failed')}
        </Text>
      ) : null}
    </View>
  );
}
