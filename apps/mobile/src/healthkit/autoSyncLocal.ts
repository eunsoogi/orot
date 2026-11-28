import { notifyWorkoutObservationSelectionCommitted } from './foregroundWorkoutObservation';
import type { HealthKitAutoSyncResult } from './autoSync';
import { runPreviouslyRequestedHealthKit } from './autoSync';
import { configureHealthKitAutoSync } from './autoSyncSettings';
import type { HealthKitAutoSyncConfigurationResult } from './autoSyncSettings';
import {
  loadHealthKitAutoSyncSelection,
  loadHealthKitAutoSyncStatus,
} from './autoSyncCheckpoint';
import type { HealthKitAutoSyncFeature } from './autoSyncCheckpoint';

const pendingLocalRuns = new Map<
  'automatic' | 'manual',
  Promise<HealthKitAutoSyncResult>
>();

/** An explicit sync can replay already-requested visible workouts, but never
 * request HealthKit authorization. Launch/foreground stays incremental. */
export function syncLocalPreviouslyRequestedHealthKit(
  mode: 'automatic' | 'manual' = 'automatic',
): Promise<HealthKitAutoSyncResult> {
  const pending = pendingLocalRuns.get(mode);
  if (pending) return pending;

  const run = syncLocalHealthKit(mode);
  pendingLocalRuns.set(mode, run);
  const clear = () => {
    if (pendingLocalRuns.get(mode) === run) pendingLocalRuns.delete(mode);
  };
  run.then(clear, clear);
  return run;
}

/** Loads saved opt-ins without exposing HealthKit's unobservable read grants. */
export async function loadLocalHealthKitAutoSyncSelection(): Promise<
  HealthKitAutoSyncFeature[]
> {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const repository = await openLocalStorage();
  return loadHealthKitAutoSyncSelection(repository);
}

/** Reads only the last aggregate status and time for the Settings recovery view. */
export async function loadLocalHealthKitAutoSyncStatus() {
  const { openLocalStorage } = await import('../storage/secureDatabase');
  const repository = await openLocalStorage();
  return loadHealthKitAutoSyncStatus(repository);
}

/** Saves the user's category choices, requests access once, and runs the first refresh. */
export async function configureLocalHealthKitAutoSync(
  selected: readonly HealthKitAutoSyncFeature[],
  onSelectionCommitted?: () => void,
): Promise<HealthKitAutoSyncConfigurationResult> {
  let committed = false;
  try {
    const [{ healthKit }, { openLocalStorage }] = await Promise.all([
      import('.'),
      import('../storage/secureDatabase'),
    ]);
    const repository = await openLocalStorage();
    return await configureHealthKitAutoSync(selected, {
      repository,
      healthKit,
      now: () => new Date().toISOString(),
      onSelectionCommitted() {
        committed = true;
        notifyWorkoutObservationSelectionCommitted();
        onSelectionCommitted?.();
      },
    });
  } catch {
    // A failure after the durable write belongs to refresh, not preference save.
    return committed
      ? { status: 'retryable', attemptedFeatures: [] }
      : { status: 'selection_save_failed', attemptedFeatures: [] };
  }
}

async function syncLocalHealthKit(
  mode: 'automatic' | 'manual',
): Promise<HealthKitAutoSyncResult> {
  try {
    const [{ healthKit }, { openLocalStorage }] = await Promise.all([
      import('.'),
      import('../storage/secureDatabase'),
    ]);
    const repository = await openLocalStorage();
    const options = {
      repository,
      healthKit,
      now: () => new Date().toISOString(),
    };
    return runPreviouslyRequestedHealthKit(options, mode);
  } catch {
    return { status: 'retryable', attemptedFeatures: [] };
  }
}
