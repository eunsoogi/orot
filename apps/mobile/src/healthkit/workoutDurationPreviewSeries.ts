import type { HealthObservation } from '@orot/domain';
import type { ChartSeries } from '../ui/charts';
import {
  dateKey,
  dayFormatter,
  shiftDate,
} from '../healthEvidence/healthContext/calendarDate';
import { provenanceLabel } from './healthRecordsDetailPresentation';

type Bucket = { value: number; source: string };
type SourceSeries = { label: string; buckets: Map<string, Bucket> };

/** Aggregate only comparable workout durations from the same identified source. */
export function workoutDurationPreviewSeries(
  records: readonly HealthObservation[],
  unit: string,
  timeZone: string,
  clipped: boolean,
): ChartSeries[] {
  const formatter = dayFormatter(timeZone);
  const series = new Map<string, SourceSeries>();
  const sessions = new Set<string>();
  const days = new Set<string>();
  for (const observation of records) {
    const { value, provenance } = observation;
    const time = Date.parse(observation.effectiveAt);
    if (
      observation.concept !== 'workout_duration' ||
      value.kind !== 'quantity' ||
      value.unit !== unit ||
      !Number.isFinite(value.amount) ||
      value.amount < 0 ||
      !Number.isFinite(time) ||
      sessions.has(observation.id)
    )
      continue;
    const date = dateKey(formatter, time);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) continue;
    sessions.add(observation.id);
    const source = provenance.source;
    const identity = JSON.stringify(
      source?.sourceIdentifier
        ? ['source', provenance.origin, source.system, source.sourceIdentifier]
        : ['unknown', observation.id],
    );
    const label = provenanceLabel(observation);
    const group = series.get(identity) ?? { label, buckets: new Map() };
    const previous = group.buckets.get(date)?.value ?? 0;
    const total = previous + value.amount;
    if (!Number.isFinite(total)) continue;
    group.buckets.set(date, { value: total, source: label });
    series.set(identity, group);
    days.add(date);
  }
  const dates = [...days].sort();
  if (!dates.length) return [];
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  // Keep month-sized absent-day positions without making zeros or selectable measurements.
  const extent = (Date.parse(last) - Date.parse(first)) / 86400_000;
  const axis =
    extent <= 31
      ? Array.from({ length: extent + 1 }, (_, i) => shiftDate(first, i))
      : dates;
  return [...series.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group], index) => ({
      id: 'workout-duration-' + String(index),
      label: group.label,
      unit,
      style: index === 0 ? 'primary' : 'secondary',
      points: axis.map(x => {
        const bucket = group.buckets.get(x);
        return {
          x,
          value: bucket?.value ?? null,
          source: bucket?.source ?? group.label,
          ...(bucket && clipped && x === first ? { partial: true } : {}),
        };
      }),
    }));
}
