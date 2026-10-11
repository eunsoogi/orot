import { healthKit } from '..';
import { openLocalStorage } from '../../storage/secureDatabase';
import { syncHealthKitBloodPressure } from './sync';
import type {
  BloodPressureObservation,
  BloodPressureSyncResult,
} from './types';

const bloodPressureConcepts = new Set([
  'blood pressure systolic',
  'blood pressure diastolic',
]);

/** Keeps the explicit user import action on the app's encrypted local repository. */
export async function importLocalBloodPressure(): Promise<BloodPressureSyncResult> {
  const repository = await openLocalStorage();
  return syncHealthKitBloodPressure({
    healthKit,
    repository,
    now: () => new Date().toISOString(),
    rememberForAutoSync: true,
  });
}

/** Returns only persisted components; an absent pressure component stays absent. */
export async function listLocalBloodPressureObservations(): Promise<
  BloodPressureObservation[]
> {
  const repository = await openLocalStorage();
  const records = await repository.list('health_observation');
  return records
    .filter(record => bloodPressureConcepts.has(record.concept))
    .sort((left, right) => {
      const byTime = right.effectiveAt.localeCompare(left.effectiveAt);
      if (byTime !== 0) return byTime;

      // Keep components from a shared timestamp in the conventional BP order.
      const byComponent =
        Number(left.concept === 'blood pressure diastolic') -
        Number(right.concept === 'blood pressure diastolic');
      return byComponent || left.id.localeCompare(right.id);
    });
}
