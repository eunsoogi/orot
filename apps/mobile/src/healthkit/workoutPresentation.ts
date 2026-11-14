import type { HealthObservation } from '@orot/domain';
import { formatHealthDuration } from '../i18n/healthDuration';
import { t } from '../i18n';

/** Names come from the native SDK mapping; a future code never becomes a guessed sport. */
export function workoutActivityLabel(observation: HealthObservation): string {
  const name = observation.workout?.activityName;
  const labels: Readonly<Record<string, string>> = {
    walking: t('healthRecords.workout.walking'),
    running: t('healthRecords.workout.running'),
    cycling: t('healthRecords.workout.cycling'),
    swimming: t('healthRecords.workout.swimming'),
    hiking: t('healthRecords.workout.hiking'),
    yoga: t('healthRecords.workout.yoga'),
    strength: t('healthRecords.workout.strength'),
    functionalStrength: t('healthRecords.workout.functionalStrength'),
    cardio: t('healthRecords.workout.cardio'),
    interval: t('healthRecords.workout.interval'),
  };
  return name && Object.hasOwn(labels, name)
    ? labels[name]!
    : t('healthRecords.category.workouts');
}

/** Round only presentation to whole minutes; stored source duration stays unchanged. */
export function formatWorkoutMinutes(value: number): string {
  return (
    formatHealthDuration('workouts', value, 'min') ??
    t('healthRecords.workout.minutes', { minutes: value })
  );
}
