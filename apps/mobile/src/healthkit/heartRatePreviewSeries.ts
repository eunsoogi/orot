import type { HealthObservation } from '@orot/domain';
import { t } from '../i18n';
import type { ChartPoint, ChartSeries } from '../ui/charts/types';
import { provenanceLabel } from './healthRecordsDetailPresentation';
import { selectHealthRecordPreviewRanks } from './healthRecordPreview';
import { disjointDiscreteHeartRatePoints } from './disjointDiscreteHeartRatePoints';
import { discreteHeartRateRangeOnLocalDay } from './discreteHeartRateRangeOnLocalDay';
import { heartRateDayBuckets } from './heartRateInstantBuckets';

type Measurement = { id: string; effectiveAt: string; amount: number };
type Point = ChartPoint & { value: number; endAt?: string };

function sourceIdentity(record: HealthObservation | undefined, id: string) {
  const source = record?.provenance.source;
  if (!source?.sourceIdentifier) return JSON.stringify(['unknown', id]);
  // A product identifier can be shared by devices with different recorded models.
  return JSON.stringify([
    source.system,
    source.sourceIdentifier,
    source.productType ?? null,
    source.device?.model ?? null,
  ]);
}

/** A preview can trim plotted points, but never joins samples from distinct sensors. */
export function heartRatePreviewSeries(
  unit: string,
  input: readonly Measurement[],
  records: ReadonlyMap<string, HealthObservation>,
  partial: boolean,
  limitPreviewDays = true,
): ChartSeries[] {
  const grouped = new Map<string, { label: string; measurements: Point[] }>();
  for (const item of input) {
    const record = records.get(item.id);
    const id = sourceIdentity(record, item.id);
    const source = record
      ? provenanceLabel(record)
      : t('healthRecords.sourceUnavailable');
    const bucket = grouped.get(id) ?? { label: source, measurements: [] };
    const range = record && discreteHeartRateRangeOnLocalDay(record);
    bucket.measurements.push({
      x: item.effectiveAt,
      endAt: record?.endedAt,
      value: item.amount,
      source,
      ...(range ? { range } : {}),
    });
    grouped.set(id, bucket);
  }
  const series = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group], index): ChartSeries => ({
      id: `heart-rate-${encodeURIComponent(unit)}-${index}`,
      label: group.label,
      unit,
      style: 'primary',
      points: heartRateDayBuckets(
        disjointDiscreteHeartRatePoints(group.measurements),
      ).map(point => ({
        ...point,
        ...(partial ? { partial: true } : {}),
      })),
    }));
  if (!limitPreviewDays) return series;
  // Preserve all sources on selected days while bounding distinct tick dates.
  const selectedDays = new Set(
    selectHealthRecordPreviewRanks(
      [
        ...new Set(series.flatMap(item => item.points.map(point => point.x))),
      ].sort(),
    ),
  );
  return series.flatMap(item => {
    const points = item.points.filter(point => selectedDays.has(point.x));
    return points.length ? [{ ...item, points }] : [];
  });
}
