import { t } from '../../i18n';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { sleepRecordSemantics } from '../../healthkit/sleep/sleepRecordSemantics';

const quantityLabels: Readonly<Record<string, string>> = {
  'blood pressure systolic': t('healthSemantic.systolic'),
  blood_pressure_systolic: t('healthSemantic.systolic'),
  'blood pressure diastolic': t('healthSemantic.diastolic'),
  blood_pressure_diastolic: t('healthSemantic.diastolic'),
  heart_rate: t('healthSemantic.heartRate'),
  body_mass: t('healthSemantic.weight'),
  weight: t('healthSemantic.weight'),
  step_count: t('healthSemantic.steps'),
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
