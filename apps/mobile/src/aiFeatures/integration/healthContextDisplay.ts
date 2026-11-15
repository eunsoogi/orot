import type { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import { t } from '../../i18n';

/** Presentation labels only; unknown concept and stage identifiers retain their original fallback. */
export const labels: Readonly<Record<string, string>> = {
  'blood pressure systolic': t('healthContextCopy.systolic'),
  'blood pressure diastolic': t('healthContextCopy.diastolic'),
  heart_rate: t('healthContextCopy.heartRate'),
  body_mass: t('healthContextCopy.bodyMass'),
  step_count: t('healthContextCopy.steps'),
  workout_duration: t('healthContextCopy.workoutDuration'),
};
export const stages: Readonly<Record<string, string>> = {
  asleepCore: t('healthContextCopy.sleepCore'),
  asleepDeep: t('healthContextCopy.sleepDeep'),
  asleepREM: t('healthContextCopy.sleepREM'),
  asleepUnspecified: t('healthContextCopy.sleepUnspecified'),
  awake: t('healthContextCopy.awake'),
  inBed: t('healthContextCopy.inBed'),
  unsupported: t('healthContextCopy.unsupportedStage'),
};

/** Missing comparisons remain absent; preserve the original sign, unit and recorded-day counts. */
export function comparisonText(
  series: ReturnType<typeof projectHealthContext>['quantities'][number],
) {
  const { difference, previousRecordedDays, recentRecordedDays } =
    series.comparison;
  if (difference === null) return '';
  return t('healthContextCopy.comparisonValue', {
    difference: `${difference > 0 ? '+' : ''}${difference}`,
    unit: series.unit,
    previous: previousRecordedDays,
    recent: recentRecordedDays,
  });
}
