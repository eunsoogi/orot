import type { SqlDatabase } from '@orot/storage';
import type {
  PeriodWorkout,
  WorkoutPeriod,
} from '../../healthkit/workoutPeriodCohort';

export type OverviewWorkoutRecovery = {
  readonly database: SqlDatabase;
  readonly period: WorkoutPeriod;
  readonly cohort?: readonly PeriodWorkout[];
};

/** When a cohort was observed, require its precise membership again. A guarded reimport
 * must not silently authorize a different workout in this request. */
export function overviewWorkoutCohortFence(
  previous?: readonly PeriodWorkout[],
) {
  let dispatched: readonly PeriodWorkout[] | undefined;
  return {
    admit(next: readonly PeriodWorkout[]) {
      if (previous) {
        const byId = new Map(next.map(workout => [workout.id, workout]));
        if (
          previous.length !== byId.size ||
          previous.some(workout => {
            const item = byId.get(workout.id);
            return (
              !item ||
              item.start !== workout.start ||
              item.end !== workout.end ||
              item.sourceBundle !== workout.sourceBundle
            );
          })
        )
          return false;
      }
      dispatched = next;
      return true;
    },
    dispatched: () => dispatched,
  };
}

/** A no-longer-current SQLite epoch can be replaced once, only inside the same
 * route/window/database scope. Settlement cannot authorize the replacement by itself. */
export async function canReacquireOverviewWorkoutSnapshot(
  epochCurrent: boolean | undefined,
  scopeCurrent: () => boolean,
  awaitWriter: () => Promise<boolean>,
  confirmProtection: () => Promise<boolean>,
) {
  return (
    epochCurrent === false &&
    scopeCurrent() &&
    (await awaitWriter()) &&
    scopeCurrent() &&
    (await confirmProtection()) &&
    scopeCurrent()
  );
}

/** The existing rolling seven-day period uses local midnights. Crossing a
 * local midnight or time-zone change retires the current period selection. */
export function overviewWorkoutReadWindow(previous?: WorkoutPeriod) {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  ).getTime();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    period: previous ?? {
      fromInclusive: from.toISOString(),
      toExclusive: now.toISOString(),
    },
    delay: Math.max(1, midnight - now.getTime()),
    currentWindow: () =>
      Date.now() < midnight &&
      zone === Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
