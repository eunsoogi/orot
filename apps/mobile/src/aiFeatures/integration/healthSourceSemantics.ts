import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { sleepRecordSemantics } from '../../healthkit/sleep/sleepRecordSemantics';

const quantityLabels: Readonly<Record<string, string>> = {
  'blood pressure systolic': '수축기 혈압',
  blood_pressure_systolic: '수축기 혈압',
  'blood pressure diastolic': '이완기 혈압',
  blood_pressure_diastolic: '이완기 혈압',
  heart_rate: '심박수',
  body_mass: '체중',
  weight: '체중',
  step_count: '걸음 수',
};

/** Shared source meanings accompany every retrieval route; they do not change stored facts or revisions. */
export function healthSourceSemantics(
  entry: LocalHealthEvidenceRecord,
): Record<string, unknown> | undefined {
  const record = entry.record as unknown as Record<string, unknown>;
  if (entry.kind === 'medication_definition') {
    return {
      medicationDefinition: 'health_medication_catalog_registration',
      hasScheduleMeaning:
        'registered_schedule_not_prescription_or_dose_completion',
    };
  }
  const sleep = sleepRecordSemantics(record);
  if (sleep) return sleep;
  const concept =
    typeof record.concept === 'string' ? record.concept.toLowerCase() : '';
  const value = record.value as { kind?: unknown } | undefined;
  if (value?.kind !== 'quantity' || !Object.hasOwn(quantityLabels, concept))
    return undefined;
  return {
    displayConcept: quantityLabels[concept],
    ...(concept === 'step_count'
      ? { amountUnitMeaning: 'steps_not_occurrences' }
      : {}),
  };
}
