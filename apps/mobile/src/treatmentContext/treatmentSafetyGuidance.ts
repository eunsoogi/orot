import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';

type TreatmentGuidanceKey =
  | 'treatmentSafety.withheld'
  | 'treatmentSafety.emergency'
  | 'treatmentSafety.conditionalEmergency'
  | 'treatmentSafety.clinicianPromptly'
  | 'treatmentSafety.inputRequired'
  | 'treatmentSafety.verifyReading'
  | 'treatmentSafety.repeatReading'
  | 'treatmentSafety.recordReadings'
  | 'treatmentSafety.confirmSymptoms'
  | 'treatmentSafety.discussAtVisit';

/** Only app-owned keys are returned; urgent guidance never includes generated copy. */
export function treatmentSafetyGuidance(
  result: TreatmentSafetyResult,
): readonly TreatmentGuidanceKey[] {
  if (result.status === 'withheld')
    return result.reason === 'cancelled' ? [] : ['treatmentSafety.withheld'];
  if (result.status === 'validated') return [];
  const keys: TreatmentGuidanceKey[] = [];
  if (result.actions.includes('seek_immediate_emergency_help'))
    keys.push('treatmentSafety.emergency');
  else if (
    result.actions.includes(
      'seek_immediate_emergency_help_if_warning_signs_are_present',
    )
  )
    keys.push('treatmentSafety.conditionalEmergency');
  if (result.actions.includes('contact_clinician_promptly'))
    keys.push('treatmentSafety.clinicianPromptly');
  if (result.status === 'policy') {
    if (result.actions.includes('verify_measurement_data'))
      keys.push('treatmentSafety.verifyReading');
    if (result.actions.includes('recheck_measurement_after_60_seconds'))
      keys.push('treatmentSafety.repeatReading');
    if (result.actions.includes('record_both_readings'))
      keys.push('treatmentSafety.recordReadings');
    if (result.actions.includes('defer_to_scheduled_visit'))
      keys.push('treatmentSafety.discussAtVisit');
    if (result.actions.includes('provide_required_information') || !keys.length)
      keys.push('treatmentSafety.inputRequired');
  }
  if (
    !result.actions.includes('seek_immediate_emergency_help') &&
    result.actions.includes('confirm_warning_symptoms')
  )
    keys.push('treatmentSafety.confirmSymptoms');
  return keys;
}
