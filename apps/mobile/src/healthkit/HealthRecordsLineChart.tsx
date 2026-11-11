import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { HealthObservation } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { ChartPlot, type ChartData, type ChartMetric } from '../ui/charts';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import { provenanceLabel } from './healthRecordsDetailPresentation';
import type { HealthObservationCategory } from './healthRecordsLibraryModel';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
} from './healthRecordsLibraryModel';
import { buildHealthChartSeries } from './healthRecordsChartModel';

const metrics: Partial<Record<HealthObservationCategory, ChartMetric>> = {
  blood_pressure: 'bloodPressure',
  heart_rate: 'heartRate',
  steps: 'steps',
  body_mass: 'bodyMass',
};

/** Adapts saved observations without aggregation or conversion, grouping plotted lines by recorded unit. */
export function HealthRecordsLineChart({
  category,
  observations,
  hasMore = false,
  loadState = 'ready',
}: {
  readonly category: HealthObservationCategory;
  readonly observations: readonly HealthObservation[];
  readonly hasMore?: boolean;
  readonly loadState?: 'loading' | 'ready' | 'failed';
}) {
  const [width, setWidth] = useState(0);
  const series = useMemo(
    () => buildHealthChartSeries(category, observations),
    [category, observations],
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
    return {
      metric: metrics[category] ?? 'heartRate',
      coverage: {
        requested: healthRecordPeriodTitle('month'),
        displayed,
        status,
      },
      series: series.flatMap(item => {
        const pointsByUnit = new Map<string, (typeof item.points)[number][]>();
        for (const point of item.points) {
          const unitPoints = pointsByUnit.get(point.unit) ?? [];
          unitPoints.push(point);
          pointsByUnit.set(point.unit, unitPoints);
        }
        const isDiastolic = item.key.endsWith('diastolic');
        return [...pointsByUnit].map(([unit, unitPoints]) => ({
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
          points: unitPoints.map(point => ({
            x: point.effectiveAt,
            value: point.amount,
            source: records.get(point.id)
              ? provenanceLabel(records.get(point.id)!)
              : t('healthRecords.sourceUnavailable'),
          })),
        }));
      }),
    };
  }, [category, observations, series, hasMore, loadState]);
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      testID="health-record-chart-plot-row"
    >
      <ChartPlot
        data={data}
        width={width}
        height={200}
        title={healthRecordCategoryTitle(category)}
        kind="line"
        testID={'health-record-chart-values-' + category}
        selectedPointTestID={'health-record-chart-' + category}
      />
      <Text>{t('healthRecords.measuredOnly')}</Text>
    </View>
  );
}
