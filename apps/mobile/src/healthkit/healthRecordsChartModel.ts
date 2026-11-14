import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordCategory } from './healthRecordsLibraryModel';

export interface HealthChartPoint {
  readonly id: string;
  readonly effectiveAt: string;
  readonly amount: number;
  readonly unit: string;
  readonly label: string;
}

export interface HealthChartSeries {
  readonly key: string;
  readonly label: string;
  readonly points: readonly HealthChartPoint[];
}

function seriesLabel(category: HealthRecordCategory, concept: string): string {
  if (category === 'blood_pressure') {
    return concept.endsWith('systolic')
      ? t('healthkit.bloodPressure.component.systolic')
      : t('healthkit.bloodPressure.component.diastolic');
  }
  switch (category) {
    case 'heart_rate':
      return t('healthkit.commonObservations.heartRate');
    case 'workouts':
      return t('healthRecords.category.workouts');
    case 'steps':
      return t('healthkit.commonObservations.steps');
    case 'body_mass':
      return t('healthkit.commonObservations.bodyMass');
    default:
      return concept;
  }
}

/** Keeps each line to actual saved quantities and avoids comparing unlike units. */
export function buildHealthChartSeries(
  category: HealthRecordCategory,
  observations: readonly HealthObservation[],
): HealthChartSeries[] {
  const groups = new Map<string, HealthChartPoint[]>();
  for (const observation of observations) {
    if (
      observation.value.kind !== 'quantity' ||
      !Number.isFinite(observation.value.amount) ||
      !Number.isFinite(new Date(observation.effectiveAt).getTime())
    ) {
      continue;
    }
    const key =
      category === 'blood_pressure'
        ? observation.concept
        : observation.value.unit;
    const points = groups.get(key) ?? [];
    points.push({
      id: observation.id,
      effectiveAt: observation.effectiveAt,
      amount: observation.value.amount,
      unit: observation.value.unit,
      label: seriesLabel(category, observation.concept),
    });
    groups.set(key, points);
  }

  return [...groups.entries()].map(([key, points]) => {
    // Sort instants rather than their textual offsets; loaded pages may be partial.
    const ordered = points.sort(
      (left, right) =>
        Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt),
    );
    const first = ordered[0];
    return {
      key,
      label: first?.label ?? key,
      points: ordered,
    };
  });
}

export function healthChartSummary(
  series: readonly HealthChartSeries[],
  title: string,
): string {
  const points = series.flatMap(item => item.points);
  if (points.length === 0) return t('healthRecords.chartEmpty', { title });
  const values = points.map(
    point =>
      formatRecordedAt(point.effectiveAt) +
      ' ' +
      point.label +
      ' ' +
      point.amount +
      ' ' +
      point.unit,
  );
  return t('healthRecords.chartSummary', {
    title,
    count: points.length,
    values: values.join('. '),
  });
}
