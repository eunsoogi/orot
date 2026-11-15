import { t } from '../i18n';
import type { ComputedFact } from './computedStatisticChoice';

const limits: Readonly<Record<string, string>> = {
  quantity_sensor_series_limit_reached: t('computedLimits.measurementLimit'),
  medication_catalog_limit_reached: t('computedLimits.medicationLimit'),
  unsupported_sleep_categories_excluded_from_duration: t(
    'computedLimits.unsupportedSleep',
  ),
  unrecorded_days_are_unknown_not_zero_or_missed_doses: t(
    'computedLimits.unrecordedUnknown',
  ),
  medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion:
    t('computedLimits.registrationNotDose'),
  sensor_step_sample_sums_may_overlap_do_not_add_series_or_infer_complete_daily_totals:
    t('computedLimits.overlappingSteps'),
};

/** Known app-authored aggregation limits survive in final uncertainty and preview.
 * Unknown codes become a visible scope warning, never raw internal identifiers.
 * The projection's cross-topic medication rule belongs only to medication summaries. */
export function computedSummaryLimitations(source: ComputedFact): string[] {
  if (!Array.isArray(source.limitations)) return [];
  return [
    ...new Set(
      source.limitations.flatMap(code => {
        if (typeof code !== 'string') return [];
        if (
          code === 'unrecorded_days_are_unknown_not_zero_or_missed_doses' &&
          source.topic === 'medications'
        )
          return [t('computedLimits.doseUnknown')];
        if (
          code ===
            'medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion' &&
          source.topic !== 'medications'
        )
          return [];
        return [
          Object.hasOwn(limits, code)
            ? limits[code]!
            : t('computedLimits.unknownScope'),
        ];
      }),
    ),
  ];
}
