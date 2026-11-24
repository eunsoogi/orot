import type { HealthObservationCursor, RecordRepository } from '@orot/storage';
import { importedWorkoutUUID } from './workoutHeartRate';

export type WorkoutPeriod = Readonly<{
  fromInclusive: string;
  toExclusive: string;
}>;

export type PeriodWorkout = Readonly<{
  id: string;
  start: string;
  end: string;
  sourceBundle: string;
}>;

const pageSize = 64;
const maximumCompleteWorkouts = 512;

/** Capture only exact imported workout IDs for the native protected reader.
 * An interrupted or oversized snapshot cannot be used as a partial denominator.
 */
export async function loadWorkoutPeriodCohort(
  repository: Pick<RecordRepository, 'listHealthObservationPage'>,
  period: WorkoutPeriod,
  current: () => boolean,
): Promise<readonly PeriodWorkout[] | undefined> {
  const from = Date.parse(period.fromInclusive);
  const to = Date.parse(period.toExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return;
  let cursor: HealthObservationCursor | null = null;
  let rows = 0;
  const result: PeriodWorkout[] = [];
  const seen = new Set<string>();
  do {
    if (!current()) return;
    const page = await repository.listHealthObservationPage(cursor, pageSize, {
      category: 'workouts',
      fromInclusive: period.fromInclusive,
      toInclusive: period.toExclusive,
      matchWorkoutOverlap: true,
    });
    if (!current() || page.records.length > pageSize) return;
    rows += page.records.length;
    if (rows > maximumCompleteWorkouts) return;
    for (const workout of page.records) {
      const id = importedWorkoutUUID(workout)?.toLowerCase();
      if (!id) continue;
      const start = Date.parse(workout.effectiveAt);
      const end = Date.parse(workout.endedAt ?? '');
      const sourceBundle = workout.provenance.source?.sourceIdentifier;
      if (
        !(start < to && from < end && start < end) ||
        !sourceBundle ||
        seen.has(id)
      )
        return;
      seen.add(id);
      result.push({
        id,
        start: workout.effectiveAt,
        end: workout.endedAt!,
        sourceBundle,
      });
    }
    const next = page.nextCursor;
    if (
      next &&
      (!page.records.length ||
        (cursor?.id === next.id && cursor.effectiveAt === next.effectiveAt))
    )
      return;
    cursor = next;
  } while (cursor);
  return current() ? result : undefined;
}
