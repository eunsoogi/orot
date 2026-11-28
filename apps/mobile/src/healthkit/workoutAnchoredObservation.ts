import type { HealthKitNativeModule } from './types';
import type { CommonObservationRepository } from './commonObservations/syncOptions';
import { syncCommonObservationChanges } from './commonObservations/sync';
import { healthKitAutoSyncCheckpointKey } from './autoSyncCheckpoint';

/** The wake has no read authority. Recheck the durable workout opt-in and
 * exact active storage/native owner before scheduling the existing importer. */
export async function syncObservedWorkoutChanges(input: {
  repository: CommonObservationRepository;
  healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'>;
  confirmProtected(): Promise<boolean>;
  current(): boolean;
  now(): string;
}) {
  const key = healthKitAutoSyncCheckpointKey('workouts');
  if (
    !input.current() ||
    (await input.repository.getSyncCheckpoint(key))?.value !== 'requested' ||
    !input.current() ||
    !(await input.confirmProtected()) ||
    !input.current()
  )
    return;
  return syncCommonObservationChanges({
    feature: 'workouts',
    healthKit: input.healthKit,
    repository: input.repository,
    permissionPreviouslyRequested: true,
    operationCurrent: input.current,
    confirmOperationCurrent: input.confirmProtected,
    now: input.now,
  });
}
