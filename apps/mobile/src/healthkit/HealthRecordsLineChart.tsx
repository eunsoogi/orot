import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import {
  buildHealthChartSeries,
  healthChartSummary,
} from './healthRecordsChartModel';

const metrics: Partial<Record<HealthObservationCategory, ChartMetric>> = {
  blood_pressure: 'bloodPressure',
  heart_rate: 'heartRate',
  steps: 'steps',
  body_mass: 'bodyMass',
};

/** Adapts saved observations without aggregation, unit conversion, or filling gaps. */
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
    const displayed = points.length
      ? `${formatRecordedAt(points[0]!.effectiveAt)} – ${formatRecordedAt(points[points.length - 1]!.effectiveAt)}`
      : t('chart.state.empty');
    return {
      metric: metrics[category] ?? 'heartRate',
      coverage: {
        requested: healthRecordPeriodTitle('month'),
        displayed,
        status:
          loadState === 'loading'
            ? 'loading'
            : loadState === 'failed'
              ? 'error'
              : hasMore
                ? 'partial'
                : points.length
                  ? 'ready'
                  : 'empty',
      },
      series: series.map((item, index) => ({
        // Stored units and concept identifiers are not guaranteed to be valid chart keys.
        id: `series_${index}`,
        label: item.label,
        unit: item.points[0]?.unit ?? '',
        style:
          category === 'blood_pressure' && item.key.endsWith('diastolic')
            ? 'secondary'
            : 'primary',
        points: item.points.map(point => ({
          x: point.effectiveAt,
          value: point.amount,
          source: records.get(point.id)
            ? provenanceLabel(records.get(point.id)!)
            : t('healthRecords.sourceUnavailable'),
        })),
      })),
    };
  }, [category, observations, series, hasMore, loadState]);
  return (
    <View
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      testID="health-record-chart-plot-row"
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={healthChartSummary(
          series,
          healthRecordCategoryTitle(category),
        )}
        style={styles.summary}
        testID={'health-record-chart-' + category}
      />
      <ChartPlot
        data={data}
        width={width}
        height={200}
        title={healthRecordCategoryTitle(category)}
        kind="line"
        testID={'health-record-chart-values-' + category}
      />
      <Text>{t('healthRecords.measuredOnly')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ summary: { width: 1, height: 1 } });
