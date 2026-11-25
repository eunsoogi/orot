import { workoutReadDiagnostics } from './workoutReadDiagnostics';
import type { RecordRepository } from '@orot/storage';
import {
  loadWorkoutPeriodCohort,
  type WorkoutPeriod,
  type PeriodWorkout,
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
  observeReadCohort?(cohort: readonly PeriodWorkout[]): void;
  admitNativeCohort?(cohort: readonly PeriodWorkout[]): boolean;
}>;
const trace = workoutReadDiagnostics('shared');
type Available = Extract<WorkoutPeriodResult, { status: 'available' }>;

/** Both the protected SQL cohort and HealthKit membership must be proved in
 * this owner lifetime. The returned witness is local-only, not a dispatch grant. */
export async function readOwnedWorkoutPeriod(
  period: WorkoutPeriod,
  owner: Owner,
  requireVisiblePeriodMatch = false,
) {
  const scope = Object.freeze({ ...period });
  const read = async (): Promise<WorkoutPeriodResult | undefined> => {
    const current = () => !owner.signal.aborted && owner.current();
    try {
      const cohort = await trace.observe(
        'cohort',
        () => loadWorkoutPeriodCohort(owner.repository, scope, current),
        current,
      );
      if (cohort?.length === 0) trace.report('cohort', 'empty');
      // Preserve the exact cohort for one caller-owned local reacquisition.
      // It is not native admission; protection and currentness still follow.
      if (cohort && current()) owner.observeReadCohort?.(cohort);
      if (
        !cohort ||
        !current() ||
        !(await trace.observe('reproof', owner.confirm, current)) ||
        !current()
      )
        return undefined;
      if (owner.admitNativeCohort?.(cohort) === false) {
        trace.report('cohort', 'failed');
        return undefined;
      }
      // The optional local consumer guard cannot replace either source reproof.
      if (!current()) return undefined;
      const result = await readWorkoutPeriodHeartRate(
        scope,
        cohort,
        owner.signal,
        requireVisiblePeriodMatch
          ? { requireVisiblePeriodMatch: true }
          : undefined,
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

/** Candidate local proof for an explicitly scoped Conversation workout read.
 * This is not a provider dispatch fence and is not offered by Conversation yet. */
export function readLocalConversationWorkoutPeriod(
  period: WorkoutPeriod,
  owner: Owner,
) {
  return readOwnedWorkoutPeriod(period, owner, true);
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
