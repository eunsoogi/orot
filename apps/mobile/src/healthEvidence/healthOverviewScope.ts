import type { RecordKind } from '@orot/storage';
import type { LocalHealthEvidenceRecord } from './localEvidenceRepository';

export const HEALTH_OVERVIEW_KINDS = new Set<RecordKind>([
  'medication_definition',
  'medication_assertion',
  'dose_event',
  'health_observation',
  'symptom_entry',
]);

// Fixed SQL constants prioritize sparse requested concepts before dense unrelated measurements.
// Other measurements remain eligible; this bounded view never claims an exhaustive history.
export const HEALTH_OVERVIEW_PRIORITY_SQL = `CASE WHEN lower(json_extract(r.payload_json, '$.concept')) IN (
  'blood pressure systolic', 'blood_pressure_systolic', 'blood pressure diastolic',
  'blood_pressure_diastolic', 'heart_rate', 'body_mass', 'weight', 'step_count',
  'hkcategorytypeidentifiersleepanalysis', 'sleep') THEN 1 ELSE 0 END`;

export type HealthOverviewGroup =
  'medications' | 'doses' | 'measurements' | 'activity' | 'sleep' | 'symptoms';
export const HEALTH_OVERVIEW_GROUP_LIMITS: Readonly<
  Record<HealthOverviewGroup, number>
> = {
  medications: 6,
  doses: 4,
  measurements: 6,
  activity: 2,
  sleep: 2,
  symptoms: 2,
};

export function healthOverviewGroup(
  entry: LocalHealthEvidenceRecord,
): HealthOverviewGroup | undefined {
  if (
    entry.kind === 'medication_definition' ||
    entry.kind === 'medication_assertion'
  )
    return 'medications';
  if (entry.kind === 'dose_event') return 'doses';
  if (entry.kind === 'symptom_entry') return 'symptoms';
  if (entry.kind !== 'health_observation') return undefined;
  const concept = entry.record.concept.toLowerCase();
  if (concept === 'step_count') return 'activity';
  if (
    concept === 'sleep' ||
    concept === 'hkcategorytypeidentifiersleepanalysis'
  )
    return 'sleep';
  return 'measurements';
}
