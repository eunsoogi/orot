import type { HealthObservation } from '@orot/domain';
import type {
  BloodPressureReading,
  HealthObservationCategory,
  HealthRecordPeriod,
} from './healthRecordsLibraryModel';
import {
  classifyHealthObservation,
  filterObservationsByPeriod,
  groupBloodPressureObservations,
} from './healthRecordsLibraryModel';

export type HealthRecordsDetailRow =
  | { readonly kind: 'blood_pressure'; readonly reading: BloodPressureReading }
  | { readonly kind: 'observation'; readonly observation: HealthObservation };

export const healthRecordPeriods: readonly HealthRecordPeriod[] = [
  'month',
  'three_months',
  'six_months',
  'year',
  'all',
];

/** Derives only saved rows for the requested category and time window. */
export function buildHealthRecordsDetailRows(
  category: HealthObservationCategory,
  records: readonly HealthObservation[],
  period: HealthRecordPeriod,
  now: string,
): HealthRecordsDetailRow[] {
  const inPeriod = filterObservationsByPeriod(records, period, now);
  if (category === 'blood_pressure') {
    return groupBloodPressureObservations(inPeriod).map(reading => ({
      kind: 'blood_pressure',
      reading,
    }));
  }
  return inPeriod
    .filter(item => classifyHealthObservation(item) === category)
    .map(observation => ({ kind: 'observation', observation }));
}
