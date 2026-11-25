import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { isAppleDerivedHeartRateCategory } from '@orot/storage';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import {
  ChartPlot,
  type ChartData,
  type ChartMetric,
  type ChartSeries,
} from '../ui/charts';
import { heartRatePreviewSeries } from './heartRatePreviewSeries';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { provenanceLabel } from './healthRecordsDetailPresentation';
import type { HealthObservationCategory } from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
} from './healthRecordsLibraryModel';
import { buildHealthChartSeries } from './healthRecordsChartModel';
import { heartRateInstantBuckets } from './heartRateInstantBuckets';
import { workoutDurationPreviewSeries } from './workoutDurationPreviewSeries';
import { workoutRecordsChartKind } from '../ui/charts/workoutRecordsChart';

const metrics: Partial<Record<HealthObservationCategory, ChartMetric>> = {
  blood_pressure: 'bloodPressure',
  heart_rate: 'heartRate',
  resting_heart_rate: 'heartRate',
  walking_heart_rate_average: 'heartRate',
  steps: 'steps',
  workouts: 'workouts',
  body_mass: 'bodyMass',
};

/** Adapts saved observations by recorded unit; heart-rate previews preserve exact source cohorts. */
export function HealthRecordsLineChart({
  category,
  observations,
  hasMore = false,
  loadState = 'ready',
  preview = false,
}: {
  readonly category: HealthObservationCategory;
  readonly observations: readonly HealthObservation[];
  readonly hasMore?: boolean;
  readonly preview?: boolean;
  readonly loadState?: 'loading' | 'ready' | 'failed';
}) {
  const [width, setWidth] = useState(0);
  const derived = isAppleDerivedHeartRateCategory(category);
  const previewRange = preview && category === 'heart_rate';
  const dailyHeartPreview = preview && (previewRange || derived);
  const workoutBars = preview && category === 'workouts';
  const series = useMemo(
    () =>
      buildHealthChartSeries(
        category,
        workoutBars
          ? observations.filter(record => record.concept === 'workout_duration')
          : observations,
      ),
    [category, observations, workoutBars],
  );
  const data = useMemo<ChartData>(() => {
    const records = new Map(observations.map(item => [item.id, item]));
    const points = series
      .flatMap(item => item.points)
      .sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));
    // Keep measured points and their coverage visible on a recoverable refresh failure.
    const status =
      loadState === 'loading'
        ? 'loading'
        : loadState === 'failed'
          ? points.length
            ? 'stale'
            : 'error'
          : hasMore
            ? 'partial'
            : points.length
              ? 'ready'
              : 'empty';
    const displayed = points.length
      ? `${formatRecordedAt(points[0]!.effectiveAt)} – ${formatRecordedAt(points[points.length - 1]!.effectiveAt)}`
      : t(`chart.state.${status}`);
    const coverage: ChartData['coverage'] = {
      requested: healthRecordPeriodTitle('month'),
      displayed,
      status,
    };
    if (workoutBars) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return {
        metric: 'workouts',
        coverage,
        series: series.flatMap(item =>
          item.points[0]?.unit
            ? workoutDurationPreviewSeries(
                observations,
                item.points[0].unit,
                zone,
                hasMore,
              )
            : [],
        ),
      };
    }
    return {
      metric: metrics[category] ?? 'heartRate',
      ...(derived
        ? { presentation: 'whole-bpm-derived-records' as const }
        : {}),
      coverage,
      series: series.flatMap(item => {
        const pointsByUnit = new Map<string, (typeof item.points)[number][]>();
        for (const point of item.points) {
          const unitPoints = pointsByUnit.get(point.unit) ?? [];
          unitPoints.push(point);
          pointsByUnit.set(point.unit, unitPoints);
        }
        const isDiastolic = item.key.endsWith('diastolic');
        return [...pointsByUnit].flatMap(
          ([unit, unitPoints]): ChartSeries[] => {
            if (previewRange || derived) {
              // Choose daily points before dispatch; the line never merges sources or invents observations.
              return heartRatePreviewSeries(
                unit,
                unitPoints,
                records,
                hasMore,
                preview,
              );
            }
            const measurements = unitPoints.map(point => ({
              x: point.effectiveAt,
              value: point.amount,
              source: records.get(point.id)
                ? provenanceLabel(records.get(point.id)!)
                : t('healthRecords.sourceUnavailable'),
            }));
            // Page boundaries can cut through an instant. Never describe the
            // resulting stats as covering records beyond the observed page.
            const buckets =
              category === 'heart_rate'
                ? heartRateInstantBuckets(measurements)
                : measurements;
            return [
              {
                // Separate units keep both plotted scales and selected details faithful to each record.
                id: `${
                  category === 'blood_pressure'
                    ? isDiastolic
                      ? 'diastolic'
                      : 'systolic'
                    : (metrics[category] ?? 'measurement')
                }-${encodeURIComponent(unit)}`,
                label: item.label,
                unit,
                style:
                  category === 'blood_pressure' && isDiastolic
                    ? 'secondary'
                    : 'primary',
                points: buckets,
              },
            ];
          },
        );
      }),
    };
  }, [
    category,
    observations,
    series,
    hasMore,
    loadState,
    previewRange,
    derived,
    preview,
    workoutBars,
  ]);
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      testID="health-record-chart-plot-row"
    >
      <ChartPlot
        data={data}
        compact={preview}
        accessibleCollapsedPlot={preview && !dailyHeartPreview}
        hideDetails={dailyHeartPreview || workoutBars}
        barTooltip={dailyHeartPreview || workoutBars}
        width={width}
        height={200}
        title={healthRecordCategoryTitle(category)}
        hideSeriesLegend={category === 'steps' || category === 'workouts'}
        legendLabelsOnly={metrics[category] === 'heartRate'}
        kind={workoutRecordsChartKind(
          workoutBars ? category : '',
          category === 'heart_rate' ? 'range' : 'line',
        )}
        rangeAxis={previewRange ? 'day' : 'time'}
        lineAxis={derived ? 'day' : 'time'}
        testID={'health-record-chart-values-' + category}
        selectedPointTestID={'health-record-chart-' + category}
      />
      {!preview ? <Text>{t('healthRecords.measuredOnly')}</Text> : null}
    </View>
  );
}
