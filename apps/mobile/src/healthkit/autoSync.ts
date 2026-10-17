import type { HealthKitNativeModule } from './types';
import type { CommonObservationRepository } from './commonObservations/syncOptions';
import { syncCommonObservationChanges } from './commonObservations/sync';
import {
  healthKitAutoSyncCheckpointKey,
  healthKitAutoSyncFeatures,
  saveHealthKitAutoSyncStatus,
  type HealthKitAutoSyncFeature,
} from './autoSyncCheckpoint';
import { syncHealthKitBloodPressure } from './bloodPressure/sync';
import { syncHealthKitMedications } from './medications/importer';
import { syncHealthKitSleep } from './sleep/importer';

export type HealthKitAutoSyncStatus = 'skipped' | 'complete' | 'retryable';

export interface HealthKitAutoSyncResult {
  readonly status: HealthKitAutoSyncStatus;
  readonly attemptedFeatures: readonly HealthKitAutoSyncFeature[];
}

interface RunHealthKitAutoSyncOptions {
  readonly repository: CommonObservationRepository;
  readonly healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'> &
    Partial<Pick<HealthKitNativeModule, 'queryMedicationDefinitions'>>;
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
      } else if (feature === 'sleep') {
        const result = await syncHealthKitSleep({
          healthKit: options.healthKit,
          repository: options.repository,
          now: options.now,
        });
        retryable ||= result.status !== 'completed';
      } else if (feature === 'medications') {
        const queryMedicationDefinitions =
          options.healthKit.queryMedicationDefinitions;
        if (!queryMedicationDefinitions) {
          retryable = true;
          continue;
        }
        // A persisted user request permits a query-only refresh without asking again.
        const result = await syncHealthKitMedications({
          healthKit: {
            queryMedicationDefinitions,
            querySampleChanges: options.healthKit.querySampleChanges,
          },
          repository: options.repository,
          now: options.now,
        });
        retryable ||=
          result.definitions.status !== 'completed' ||
          result.doseEvents.status !== 'completed';
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

  if (attemptedFeatures.length === 0 && !retryable) {
    return { status: 'skipped', attemptedFeatures };
  }
  const status = retryable ? 'retryable' : 'complete';
  try {
    // Settings can recover from the most recent status without exposing health rows or grant state.
    await saveHealthKitAutoSyncStatus(options.repository, status, options.now);
  } catch {
    return { status: 'retryable', attemptedFeatures };
  }
  return { status, attemptedFeatures };
}
