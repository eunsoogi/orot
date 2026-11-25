import type { RecordRepository } from '@orot/storage';
import {
  loadWorkoutPeriodCohort,
  type WorkoutPeriod,
} from './workoutPeriodCohort';
import {
  readWorkoutPeriodHeartRate,
  type WorkoutPeriodResult,
} from './workoutPeriodNativeRead';

type Owner = Readonly<{
  repository: Pick<RecordRepository, 'listHealthObservationPage'>;
  signal: AbortSignal;
  current(): boolean;
  confirm(): Promise<boolean>;
}>;
type Available = Extract<WorkoutPeriodResult, { status: 'available' }>;

/** Both the protected SQL cohort and HealthKit membership must be proved in
 * this owner lifetime. The returned witness is local-only, not a dispatch grant. */
export async function readOwnedWorkoutPeriod(
  period: WorkoutPeriod,
  owner: Owner,
) {
  const scope = Object.freeze({ ...period });
  const read = async (): Promise<WorkoutPeriodResult | undefined> => {
    const current = () => !owner.signal.aborted && owner.current();
    try {
      const cohort = await loadWorkoutPeriodCohort(
        owner.repository,
        scope,
        current,
      );
      if (!cohort || !current() || !(await owner.confirm()) || !current())
        return undefined;
      const result = await readWorkoutPeriodHeartRate(
        scope,
        cohort,
        owner.signal,
      );
      return current() && (await owner.confirm()) && current()
        ? result
        : undefined;
    } catch {
      return undefined;
    }
  };
  const produced = await read();
  const result = produced && Object.freeze(produced);
  const reprove = async (): Promise<boolean> => {
    if (result?.status !== 'available') return false;
    const next = await read();
    return (
      next?.status === 'available' &&
      equalProof(result, next) &&
      !owner.signal.aborted &&
      owner.current()
    );
  };
  return { result, reprove };
}

function equalProof(left: Available, right: Available): boolean {
  // An equal aggregate alone cannot prove the same measurements. Conversely,
  // every provider-facing numeric field would also require exact agreement.
  return (
    left.membershipRevision === right.membershipRevision &&
    left.fromInclusive === right.fromInclusive &&
    left.toExclusive === right.toExclusive &&
    left.firstSampleAtMs === right.firstSampleAtMs &&
    left.lastSampleAtMs === right.lastSampleAtMs &&
    left.sampleCount === right.sampleCount &&
    left.minimum === right.minimum &&
    left.mean === right.mean &&
    left.maximum === right.maximum
  );
}
