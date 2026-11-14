import type { HealthObservation } from '@orot/domain';
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
  const minutes = Math.round(value);
  return minutes >= 60
    ? t('healthRecords.workout.hoursMinutes', {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
      })
    : t('healthRecords.workout.minutes', { minutes });
}
