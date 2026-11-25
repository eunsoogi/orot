import {
  isAppleDerivedHeartRateCategory,
  type HealthObservationMonthChart,
  type HealthObservationMonthChartLoader,
  type HealthObservationMonthWindow,
} from '@orot/storage';
import type {
  ChartData,
  ChartKind,
  ChartMetric,
  ChartSeries,
} from '../ui/charts/types';
import { t } from '../i18n';
import { formatRecordedAt } from '../recording/formatRecordedAt';
import {
  healthRecordCategoryTitle,
  healthRecordPeriodTitle,
} from './healthRecordsLibraryModel';

type Category = Parameters<HealthObservationMonthChartLoader>[0];
const metrics: Record<Category, ChartMetric> = {
  blood_pressure: 'bloodPressure',
  heart_rate: 'heartRate',
  resting_heart_rate: 'heartRate',
  walking_heart_rate_average: 'heartRate',
  steps: 'steps',
  workouts: 'workouts',
  body_mass: 'bodyMass',
  sleep: 'sleep',
};

function recordSource(source: string) {
  try {
    const [, system, , product] = JSON.parse(source) as unknown[];
    if (typeof system !== 'string') return t('healthRecords.sourceUnavailable');
    return [
      system === 'healthkit' ? t('healthRecords.source.healthApp') : system,
      typeof product === 'string' ? product : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  } catch {
    return t('healthRecords.sourceUnavailable');
  }
}

function localDay(instant: string) {
  const date = new Date(instant);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** The encrypted store emits observed summaries only; chart axes carry the
 * whole requested month independently of whether its endpoints were measured. */
export function buildHealthRecordsMonthChart(
  category: Category,
  xWindow: HealthObservationMonthWindow,
  projection?: HealthObservationMonthChart,
  failed = false,
): { data: ChartData; kind: ChartKind } {
  const metric = metrics[category];
  const derived = isAppleDerivedHeartRateCategory(category);
  const kind =
    category === 'heart_rate'
      ? 'range'
      : metric === 'workouts'
        ? 'bar'
        : 'line';
  const groups = new Map<
    string,
    ChartSeries & { points: Array<ChartSeries['points'][number]> }
  >();
  for (const row of projection?.rows ?? []) {
    if (category === 'sleep' ? !('minutes' in row) : !('mean' in row)) continue;
    const concept = 'concept' in row ? row.concept : 'sleep';
    const unit = 'unit' in row ? row.unit : 'min';
    const id = encodeURIComponent(JSON.stringify([concept, unit, row.source]));
    const secondary =
      category === 'blood_pressure' && concept.endsWith('diastolic');
    const label =
      category === 'blood_pressure'
        ? t(
            secondary
              ? 'healthkit.bloodPressure.component.diastolic'
              : 'healthkit.bloodPressure.component.systolic',
          )
        : healthRecordCategoryTitle(category);
    const item = groups.get(id) ?? {
      id,
      unit,
      label,
      style: secondary ? 'secondary' : 'primary',
      points: [],
    };
    const total = category === 'steps' || category === 'workouts';
    item.points.push({
      // Derived estimates and Steps keep their existing local day keys on the line.
      x:
        kind !== 'line' || derived || category === 'steps'
          ? localDay(row.effectiveAt)
          : row.effectiveAt,
      value: 'minutes' in row ? row.minutes : total ? row.sum : row.mean,
      source: recordSource(row.source),
      ...('min' in row && !total
        ? {
            range: {
              minimum: row.min,
              maximum: row.max,
              samples: row.sampleCount,
            },
          }
        : {}),
    });
    groups.set(id, item);
  }
  const status = failed
    ? 'error'
    : !projection
      ? 'loading'
      : groups.size
        ? 'ready'
        : 'empty';
  return {
    kind,
    data: {
      metric,
      ...(derived
        ? { presentation: 'whole-bpm-derived-records' as const }
        : {}),
      xWindow,
      coverage: {
        requested: healthRecordPeriodTitle('month'),
        displayed: groups.size
          ? formatRecordedAt(xWindow.fromInclusive) +
            ' – ' +
            formatRecordedAt(xWindow.toInclusive)
          : t(`chart.state.${status}`),
        status,
      },
      series: [...groups.values()],
    },
  };
}
