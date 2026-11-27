import {
  workoutReadDiagnostics,
  type WorkoutDecodeRejection,
} from './workoutReadDiagnostics';
import { NativeModules, Platform } from 'react-native';
import type { PeriodWorkout, WorkoutPeriod } from './workoutPeriodCohort';
import {
  validatedRecordsWorkoutDays,
  type RecordsWorkoutDay,
} from './recordsWorkoutDayWitness';

export type WorkoutPeriodResult =
  | { status: 'unavailable' | 'emptyVisible' }
  | {
      status: 'available';
      sampleCount: number;
      minimum: number;
      mean: number;
      maximum: number;
      firstSampleAtMs: number;
      lastSampleAtMs: number;
      membershipRevision: string;
      fromInclusive: string;
      toExclusive: string;
      days?: readonly RecordsWorkoutDay[];
    };

let nextCall = 0;
const unavailable = { status: 'unavailable' } as const;
const exactCohortPolicy = 'exact-visible-native-cohort';
type WorkoutReadContract =
  { readonly timeZone: string } | { readonly requireVisiblePeriodMatch: true };
const trace = workoutReadDiagnostics('shared');
const reject = (reason: WorkoutDecodeRejection) => {
  trace.report('decode', reason);
  return unavailable;
};

/** One local period read; native must support actual cancellation. No permissions are requested. */
export async function readWorkoutPeriodHeartRate(
  period: WorkoutPeriod,
  cohort: readonly PeriodWorkout[],
  signal: AbortSignal,
  contract?: WorkoutReadContract,
): Promise<WorkoutPeriodResult> {
  if (signal.aborted || Platform.OS !== 'ios') {
    trace.report('bridge', signal.aborted ? 'cancelled' : 'skipped');
    return unavailable;
  }
  const recordsMonthChart =
    contract && 'timeZone' in contract ? contract : undefined;
  const exact = contract && 'requireVisiblePeriodMatch' in contract;
  const api = NativeModules.HealthKitModule as
    | {
        queryWorkoutPeriodHeartRate?(
          request: WorkoutPeriod & {
            callId: string;
            recordsMonthChart?: { readonly timeZone: string };
            workoutCohortPolicy?: typeof exactCohortPolicy;
            workouts: readonly PeriodWorkout[];
          },
        ): Promise<unknown>;
        cancelWorkoutPeriodHeartRate?(callId: string): void;
      }
    | undefined;
  if (!api?.queryWorkoutPeriodHeartRate || !api.cancelWorkoutPeriodHeartRate) {
    trace.report('bridge', 'missing');
    return unavailable;
  }
  const callId = 'workout-period-' + String(++nextCall);
  const cancel = () => api.cancelWorkoutPeriodHeartRate!(callId);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    trace.report('bridge', 'started');
    const result = await api.queryWorkoutPeriodHeartRate({
      ...period,
      callId,
      ...(recordsMonthChart ? { recordsMonthChart } : {}),
      ...(exact ? { workoutCohortPolicy: exactCohortPolicy } : {}),
      workouts: cohort,
    });
    trace.report('bridge', signal.aborted ? 'cancelled' : 'completed');
    if (signal.aborted) return reject('cancelled');
    if (!result || typeof result !== 'object') return reject('payload_invalid');
    const value = result as Partial<
      Extract<WorkoutPeriodResult, { status: 'available' }>
    > & { status?: unknown };
    if (
      exact &&
      (result as { workoutCohortPolicy?: unknown }).workoutCohortPolicy !==
        exactCohortPolicy
    )
      return reject('cohort_mismatch');
    const status = (result as { status?: unknown }).status;
    if (status === 'unavailable') return reject('native_unavailable');
    if (status === 'emptyVisible') {
      trace.report('decode', 'empty');
      return { status };
    }
    if (status !== 'available') return reject('payload_invalid');
    const {
      sampleCount,
      minimum,
      mean: nativeMean,
      maximum,
      firstSampleAtMs,
      lastSampleAtMs,
      membershipRevision,
    } = value;
    if (
      value.fromInclusive !== period.fromInclusive ||
      value.toExclusive !== period.toExclusive
    )
      return reject('window_mismatch');
    if (
      typeof sampleCount !== 'number' ||
      !Number.isSafeInteger(sampleCount) ||
      sampleCount < 1 ||
      typeof minimum !== 'number' ||
      typeof nativeMean !== 'number' ||
      typeof maximum !== 'number' ||
      ![minimum, nativeMean, maximum].every(Number.isFinite) ||
      minimum <= 0 ||
      minimum > maximum
    )
      return reject('statistics_invalid');
    if (
      typeof firstSampleAtMs !== 'number' ||
      typeof lastSampleAtMs !== 'number' ||
      !Number.isSafeInteger(firstSampleAtMs) ||
      !Number.isSafeInteger(lastSampleAtMs) ||
      firstSampleAtMs < Date.parse(period.fromInclusive) ||
      lastSampleAtMs >= Date.parse(period.toExclusive) ||
      firstSampleAtMs > lastSampleAtMs
    )
      return reject('timestamps_invalid');
    if (
      typeof membershipRevision !== 'string' ||
      !/^v1:[0-9a-f]{64}$/u.test(membershipRevision)
    )
      return reject('membership_invalid');
    // The native compensated aggregate divides its rounded sum by count.
    // An exact in-range average may land just outside the measured boundary;
    // correct only machine-scale error, never a materially different value.
    const mean = Math.min(maximum, Math.max(minimum, nativeMean));
    if (Math.abs(nativeMean - mean) > Math.abs(mean) * Number.EPSILON)
      return reject('statistics_invalid');
    const days =
      recordsMonthChart &&
      validatedRecordsWorkoutDays(
        result as { days?: unknown; timeZone?: unknown },
        { ...period, sampleCount, minimum, mean, maximum },
        recordsMonthChart.timeZone,
      );
    trace.report('decode', 'available');
    return {
      ...period,
      ...(days ? { days } : {}),
      status: 'available',
      sampleCount,
      minimum,
      mean,
      maximum,
      firstSampleAtMs,
      lastSampleAtMs,
      membershipRevision,
    };
  } catch {
    trace.report('bridge', signal.aborted ? 'cancelled' : 'failed');
    return unavailable;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
