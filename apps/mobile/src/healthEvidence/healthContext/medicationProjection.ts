import type { HealthMedicationProfile } from './types';

/** Label what the source establishes without promoting registration or past doses into future adherence. */
export function projectHealthMedication({
  identity: _identity,
  ...medication
}: HealthMedicationProfile) {
  return {
    ...medication,
    // A known false schedule flag is not an unavailable field or a denial of medication use.
    scheduleStatus:
      medication.scheduleRegistered === undefined
        ? 'not_available'
        : medication.scheduleRegistered
          ? 'registered'
          : 'not_registered',
    useEvidence:
      medication.source === 'current_user_confirmation'
        ? 'user_confirmed_current_use'
        : medication.taken > 0
          ? 'recorded_doses_in_period'
          : medication.source === 'healthkit_registration'
            ? 'catalog_only'
            : 'prescription_only',
  };
}
