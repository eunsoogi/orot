import type { RecordRepository } from '@orot/storage';
import {
  commonObservationFeatures,
  type CommonObservationFeature,
} from './commonObservations/types';

export const healthKitAutoSyncFeatures = [
  ...commonObservationFeatures,
  'bloodPressure',
] as const;

export type HealthKitAutoSyncFeature =
  CommonObservationFeature | 'bloodPressure';

/** This records an explicit import request, not a HealthKit read-permission grant. */
export function healthKitAutoSyncCheckpointKey(
  feature: HealthKitAutoSyncFeature,
): string {
  return `healthkit:auto-sync-requested:${feature}`;
}

/** Keeps a user-selected category eligible for query-only refreshes on later launches. */
export async function rememberHealthKitAutoSyncRequest(
  repository: Pick<RecordRepository, 'transaction'>,
  feature: HealthKitAutoSyncFeature,
  now: () => string,
): Promise<void> {
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: healthKitAutoSyncCheckpointKey(feature),
      value: 'requested',
      updatedAt: now(),
    }),
  );
}
