import type { HealthKitNativeModule } from './types';
import type { CommonObservationRepository } from './commonObservations/syncOptions';
import { syncCommonObservationChanges } from './commonObservations/sync';
import {
  healthKitAutoSyncCheckpointKey,
  healthKitAutoSyncFeatures,
  type HealthKitAutoSyncFeature,
} from './autoSyncCheckpoint';
import { syncHealthKitBloodPressure } from './bloodPressure/sync';

export type HealthKitAutoSyncStatus = 'skipped' | 'complete' | 'retryable';

export interface HealthKitAutoSyncResult {
  readonly status: HealthKitAutoSyncStatus;
  readonly attemptedFeatures: readonly HealthKitAutoSyncFeature[];
}

interface RunHealthKitAutoSyncOptions {
  readonly repository: CommonObservationRepository;
  readonly healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'>;
  readonly now: () => string;
}

const pendingRuns = new WeakMap<object, Promise<HealthKitAutoSyncResult>>();

/** Coalesces duplicate launch refreshes while preserving each category's cursor. */
export function runHealthKitAutoSync(
  options: RunHealthKitAutoSyncOptions,
): Promise<HealthKitAutoSyncResult> {
  const pending = pendingRuns.get(options.repository);
  if (pending) return pending;

  const run = runRequestedFeatures(options);
  pendingRuns.set(options.repository, run);
  const clear = () => {
    if (pendingRuns.get(options.repository) === run) {
      pendingRuns.delete(options.repository);
    }
  };
  void run.then(clear, clear);
  return run;
}

async function runRequestedFeatures(
  options: RunHealthKitAutoSyncOptions,
): Promise<HealthKitAutoSyncResult> {
  const attemptedFeatures: HealthKitAutoSyncFeature[] = [];
  let retryable = false;

  for (const feature of healthKitAutoSyncFeatures) {
    try {
      const request = await options.repository.getSyncCheckpoint(
        healthKitAutoSyncCheckpointKey(feature),
      );
      if (request?.value !== 'requested') continue;

      attemptedFeatures.push(feature);
      if (feature === 'bloodPressure') {
        const result = await syncHealthKitBloodPressure({
          healthKit: options.healthKit,
          permissionPreviouslyRequested: true,
          repository: options.repository,
          now: options.now,
        });
        retryable ||= result.status !== 'completed';
      } else {
        const result = await syncCommonObservationChanges({
          feature,
          healthKit: options.healthKit,
          permissionPreviouslyRequested: true,
          repository: options.repository,
          now: options.now,
        });
        retryable ||= result.status !== 'complete' && result.status !== 'empty';
      }
    } catch {
      // The unchanged cursor and request marker make the same category retryable next launch.
      retryable = true;
    }
  }

  if (attemptedFeatures.length === 0) {
    return { status: 'skipped', attemptedFeatures };
  }
  return { status: retryable ? 'retryable' : 'complete', attemptedFeatures };
}
