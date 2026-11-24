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

/** One local period read; native must support actual cancellation. No permissions are requested. */
export async function readWorkoutPeriodHeartRate(
  period: WorkoutPeriod,
  cohort: readonly PeriodWorkout[],
  signal: AbortSignal,
  recordsMonthChart?: { readonly timeZone: string },
): Promise<WorkoutPeriodResult> {
  if (signal.aborted || Platform.OS !== 'ios') return unavailable;
  const api = NativeModules.HealthKitModule as
    | {
        queryWorkoutPeriodHeartRate?(
          request: WorkoutPeriod & {
            callId: string;
            recordsMonthChart?: { readonly timeZone: string };
            workouts: readonly PeriodWorkout[];
          },
        ): Promise<unknown>;
        cancelWorkoutPeriodHeartRate?(callId: string): void;
      }
    | undefined;
  if (!api?.queryWorkoutPeriodHeartRate || !api.cancelWorkoutPeriodHeartRate)
    return unavailable;
  const callId = 'workout-period-' + String(++nextCall);
  const cancel = () => api.cancelWorkoutPeriodHeartRate!(callId);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await api.queryWorkoutPeriodHeartRate({
      ...period,
      callId,
      ...(recordsMonthChart ? { recordsMonthChart } : {}),
      workouts: cohort,
    });
    if (signal.aborted || !result || typeof result !== 'object')
      return unavailable;
    const value = result as Partial<
      Extract<WorkoutPeriodResult, { status: 'available' }>
    > & { status?: unknown };
    if ((result as { status?: unknown }).status === 'emptyVisible')
      return { status: 'emptyVisible' };
    const {
      sampleCount,
      minimum,
      mean,
      maximum,
      firstSampleAtMs,
      lastSampleAtMs,
      membershipRevision,
    } = value;
    if (
      value.status !== 'available' ||
      value.fromInclusive !== period.fromInclusive ||
      value.toExclusive !== period.toExclusive ||
      typeof sampleCount !== 'number' ||
      !Number.isSafeInteger(sampleCount) ||
      sampleCount < 1 ||
      typeof minimum !== 'number' ||
      typeof mean !== 'number' ||
      typeof maximum !== 'number' ||
      ![minimum, mean, maximum].every(Number.isFinite) ||
      minimum <= 0 ||
      minimum > mean ||
      mean > maximum ||
      typeof firstSampleAtMs !== 'number' ||
      typeof lastSampleAtMs !== 'number' ||
      !Number.isSafeInteger(firstSampleAtMs) ||
      !Number.isSafeInteger(lastSampleAtMs) ||
      firstSampleAtMs < Date.parse(period.fromInclusive) ||
      lastSampleAtMs >= Date.parse(period.toExclusive) ||
      firstSampleAtMs > lastSampleAtMs ||
      typeof membershipRevision !== 'string' ||
      !/^v1:[0-9a-f]{64}$/u.test(membershipRevision)
    )
      return unavailable;
    const days =
      recordsMonthChart &&
      validatedRecordsWorkoutDays(
        result as { days?: unknown; timeZone?: unknown },
        { ...period, sampleCount, minimum, mean, maximum },
        recordsMonthChart.timeZone,
      );
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
    return unavailable;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
