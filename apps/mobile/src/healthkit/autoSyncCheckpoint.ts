import type { RecordRepository } from '@orot/storage';
import {
  commonObservationFeatures,
  type CommonObservationFeature,
} from './commonObservations/types';

export const healthKitAutoSyncFeatures = [
  ...commonObservationFeatures,
  'bloodPressure',
  'medications',
  'sleep',
] as const;

export type HealthKitAutoSyncFeature =
  CommonObservationFeature | 'bloodPressure' | 'medications' | 'sleep';
export type HealthKitAutoSyncStatus = 'complete' | 'retryable';

export const healthKitAutoSyncStatusCheckpointKey =
  'healthkit:auto-sync:last-status';

/** This stores an opt-in choice, not a HealthKit read-permission grant. */
export function healthKitAutoSyncCheckpointKey(
  feature: HealthKitAutoSyncFeature,
): string {
  return `healthkit:auto-sync-requested:${feature}`;
}

/** Loads only explicit opt-ins; disabled markers keep a saved off choice stable. */
export async function loadHealthKitAutoSyncSelection(
  repository: Pick<RecordRepository, 'getSyncCheckpoint'>,
): Promise<HealthKitAutoSyncFeature[]> {
  const checkpoints = await Promise.all(
    healthKitAutoSyncFeatures.map(feature =>
      repository.getSyncCheckpoint(healthKitAutoSyncCheckpointKey(feature)),
    ),
  );
  return healthKitAutoSyncFeatures.filter(
    (_feature, index) => checkpoints[index]?.value === 'requested',
  );
}

/** Saves category choices without touching imported records or sample cursors. */
export async function saveHealthKitAutoSyncSelection(
  repository: Pick<RecordRepository, 'transaction'>,
  selected: readonly HealthKitAutoSyncFeature[],
  now: () => string,
): Promise<void> {
  const selection = new Set(selected);
  await repository.transaction(async writer => {
    for (const feature of healthKitAutoSyncFeatures) {
      await writer.putSyncCheckpoint({
        key: healthKitAutoSyncCheckpointKey(feature),
        value: selection.has(feature) ? 'requested' : 'disabled',
        updatedAt: now(),
      });
    }
  });
}

/** Keeps the latest aggregate refresh state for Settings without storing record data. */
export async function saveHealthKitAutoSyncStatus(
  repository: Pick<RecordRepository, 'transaction'>,
  status: HealthKitAutoSyncStatus,
  now: () => string,
): Promise<void> {
  await repository.transaction(writer =>
    writer.putSyncCheckpoint({
      key: healthKitAutoSyncStatusCheckpointKey,
      value: status,
      updatedAt: now(),
    }),
  );
}

/** Rejects unknown stored values so a corrupted marker cannot look like success. */
export async function loadHealthKitAutoSyncStatus(
  repository: Pick<RecordRepository, 'getSyncCheckpoint'>,
): Promise<{
  readonly status: HealthKitAutoSyncStatus;
  readonly updatedAt: string;
} | null> {
  const checkpoint = await repository.getSyncCheckpoint(
    healthKitAutoSyncStatusCheckpointKey,
  );
  if (checkpoint?.value !== 'complete' && checkpoint?.value !== 'retryable') {
    return null;
  }
  return { status: checkpoint.value, updatedAt: checkpoint.updatedAt };
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
