import type { HealthObservationMonthWindow } from '@orot/storage';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatHeartRateBpm } from '../i18n/heartRateDisplay';
import { ChartPlot, type ChartData, type ChartPoint } from '../ui/charts';
import type { RecordsWorkoutDay } from './recordsWorkoutDayWitness';
import { useRecordsWorkoutMonthHeartRate } from './useRecordsWorkoutMonthHeartRate';

/** Daily range glyphs use actual assigned workout samples. A missing day reserves
 * an axis slot, never a zero, invented sample count or ordinary pulse value.
 */
function dataFor(days: readonly RecordsWorkoutDay[]): ChartData {
  const label = t('healthRecords.workoutHeartRate.overviewTitle');
  const source = t('healthRecords.workoutHeartRate.recordsSource');
  const points = days.map(({ date, statistics }): ChartPoint =>
    statistics
      ? {
          x: date,
          value: statistics.mean,
          source,
          range: {
            minimum: statistics.minimum,
            maximum: statistics.maximum,
            samples: statistics.sampleCount,
          },
        }
      : { x: date, value: null, source },
  );
  const observed = points.filter(point => point.value !== null).length;
  return {
    metric: 'heartRate',
    presentation: 'whole-bpm-overview',
    coverage: {
      requested: t('healthRecords.period.month'),
      displayed: t('overview.metricChartCoverage', {
        recorded: observed,
        total: days.length,
      }),
      status: observed === days.length ? 'ready' : 'partial',
    },
    series: [
      {
        id: 'workout-heart-rate-recorded',
        label,
        unit: 'count/min',
        style: 'primary',
        points,
      },
    ],
  };
}

/** Separate from workout duration and individual workout readouts. */
export function HealthRecordsWorkoutMonthHeartRate({
  window,
}: {
  readonly window: HealthObservationMonthWindow;
}) {
  const [width, setWidth] = useState(0);
  const state = useRecordsWorkoutMonthHeartRate(window);
  const title = t('healthRecords.workoutHeartRate.overviewTitle');
  return (
    <View
      testID="health-records-workout-month-heart-rate"
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <Text accessibilityRole="header">{title}</Text>
      <Text>{t('healthRecords.workoutHeartRate.recordsSource')}</Text>
      {state.status === 'available' ? (
        <>
          <Text accessibilityRole="status">
            {t('healthRecords.workoutHeartRate.periodAverage', {
              mean: formatHeartRateBpm(state.mean),
            })}
          </Text>
          {state.days ? (
            <ChartPlot
              data={dataFor(state.days)}
              compact
              hideDetails
              barTooltip
              width={width}
              height={200}
              title={title}
              kind="range"
              rangeAxis="day"
              testID="health-records-workout-heart-rate-chart"
            />
          ) : (
            <Text>
              {t('healthRecords.workoutHeartRate.recordsChartUnavailable')}
            </Text>
          )}
        </>
      ) : state.status === 'reading' ? (
        <Text accessibilityRole="status">{t('healthRecords.loading')}</Text>
      ) : state.status === 'unavailable' || state.status === 'emptyVisible' ? (
        <Text accessibilityRole="status">
          {t('healthRecords.workoutHeartRate.periodUnavailable')}
        </Text>
      ) : null}
    </View>
  );
}
