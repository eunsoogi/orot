import { t } from '../i18n';
import type { ComputedFact } from './computedStatisticChoice';
import { healthSleepAwakeConflict } from '../healthEvidence/healthContext/observationSemantics';

/** Display only positive reports of material data loss or conflict for this topic.
 * Interpretation rules and unobserved days are not failed or missing records. */
export function computedSummaryLimitations(source: ComputedFact): string[] {
  if (!Array.isArray(source.limitations)) return [];
  const codes = new Set(source.limitations);
  if (source.topic === 'sleep')
    return [
      ...(codes.has('unsupported_sleep_categories_excluded_from_duration')
        ? [t('computedLimits.unsupportedSleep')]
        : []),
      ...(codes.has(healthSleepAwakeConflict)
        ? [t('computedLimits.sleepAwakeConflict')]
        : []),
    ];
  if (
    (source.topic === 'activity' || source.topic === 'measurements') &&
    codes.has('quantity_sensor_series_limit_reached')
  )
    return [t('computedLimits.measurementLimit')];
  return source.topic === 'medications' &&
    codes.has('medication_catalog_limit_reached')
    ? [t('computedLimits.medicationLimit')]
    : [];
}
