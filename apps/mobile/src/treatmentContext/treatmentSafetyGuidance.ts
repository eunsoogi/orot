import type { TranslationKey } from '../i18n';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';

/** Only app-owned keys are returned; urgent guidance never includes generated copy. */
export function treatmentSafetyGuidance(
  result: TreatmentSafetyResult,
): readonly TranslationKey[] {
  if (result.status === 'withheld')
    return result.reason === 'cancelled' ? [] : ['treatmentSafety.withheld'];
  if (result.status !== 'urgent') return [];
  const keys: TranslationKey[] = [];
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
  return keys;
}
