import type { HealthObservation } from '@orot/domain';
import { NativeModules, Platform } from 'react-native';
import { commonObservationRecordId } from './commonObservations/mapper';

const workoutUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkoutHeartRate =
  | { status: 'notAvailable' }
  | {
      status: 'available';
      minimum: number;
      mean: number;
      maximum: number;
    };

/** Only the canonical imported workout may address a native query. A generic
 * heart-rate point, arbitrary external ID or manually entered record cannot.
 */
export function importedWorkoutUUID(record: HealthObservation): string | null {
  const ids = record.provenance.sourceRecordIds;
  if (
    record.concept !== 'workout_duration' ||
    !record.workout ||
    record.provenance.origin !== 'imported' ||
    record.provenance.source?.system !== 'healthkit' ||
    ids?.length !== 1 ||
    !workoutUUID.test(ids[0]) ||
    record.id !== commonObservationRecordId('workouts', ids[0])
  )
    return null;
  return ids[0];
}

/** This deliberately isn't part of the general importer or AI context client.
 * The permission state isn't observable, and an absent aggregate isn't zero.
 */
export async function readWorkoutHeartRate(
  id: string,
): Promise<WorkoutHeartRate> {
  if (!workoutUUID.test(id)) throw new Error('Invalid workout identifier.');
  if (Platform.OS !== 'ios') return { status: 'notAvailable' };
  const bridge = NativeModules.HealthKitModule as
    { queryWorkoutHeartRate?(id: string): Promise<unknown> } | undefined;
  if (!bridge?.queryWorkoutHeartRate) return { status: 'notAvailable' };
  const result = (await bridge.queryWorkoutHeartRate(
    id,
  )) as WorkoutHeartRate | null;
  if (result?.status === 'notAvailable') return { status: 'notAvailable' };
  if (
    result?.status !== 'available' ||
    ![result.minimum, result.mean, result.maximum].every(Number.isFinite) ||
    result.minimum <= 0 ||
    result.minimum > result.mean ||
    result.mean > result.maximum
  )
    throw new Error('Invalid associated heart rate result.');
  return {
    status: 'available',
    minimum: result.minimum,
    mean: result.mean,
    maximum: result.maximum,
  };
}
