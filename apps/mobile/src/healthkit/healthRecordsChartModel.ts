import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';
import { appColors } from '../layout/appColors';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import type { HealthRecordCategory } from './healthRecordsLibraryModel';

export interface HealthChartPoint {
  readonly id: string;
  readonly effectiveAt: string;
  readonly amount: number;
  readonly unit: string;
  readonly label: string;
  readonly color: string;
}

export interface HealthChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
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
    case 'steps':
      return t('healthkit.commonObservations.steps');
    case 'body_mass':
      return t('healthkit.commonObservations.bodyMass');
    default:
      return concept;
  }
}

function seriesColor(category: HealthRecordCategory, concept: string): string {
  return category === 'blood_pressure' && concept.endsWith('systolic')
    ? appColors.dangerAction
    : appColors.primaryAction;
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
      color: seriesColor(category, observation.concept),
    });
    groups.set(key, points);
  }

  return [...groups.entries()].map(([key, points]) => {
    // Keep the same complete period as the category count and detail list.
    const ordered = points.sort((left, right) =>
      left.effectiveAt.localeCompare(right.effectiveAt),
    );
    const first = ordered[0];
    return {
      key,
      label: first?.label ?? key,
      color: first?.color ?? appColors.primaryAction,
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

export function healthChartMaximum(
  series: readonly HealthChartSeries[],
  category: HealthRecordCategory,
): number {
  const largest = Math.max(
    1,
    ...series.flatMap(item => item.points.map(point => point.amount)),
  );
  const step = largest > 100 ? 20 : largest > 20 ? 5 : 1;
  return Math.max(
    category === 'blood_pressure' ? 200 : 0,
    Math.ceil((largest * 1.1) / step) * step,
  );
}

export function healthChartDateLabel(timestamp: string): string {
  return (
    new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
    }).format(new Date(timestamp)) +
    '\n' +
    new Intl.DateTimeFormat('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp))
  );
}
