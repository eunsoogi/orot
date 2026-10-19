import type { HealthKitAutoSyncResult } from './autoSync';
import { runHealthKitAutoSync } from './autoSync';
import { configureHealthKitAutoSync } from './autoSyncSettings';
import type { HealthKitAutoSyncConfigurationResult } from './autoSyncSettings';
import {
  loadHealthKitAutoSyncSelection,
  loadHealthKitAutoSyncStatus,
} from './autoSyncCheckpoint';
import type { HealthKitAutoSyncFeature } from './autoSyncCheckpoint';

let pendingLocalRun: Promise<HealthKitAutoSyncResult> | null = null;

/** Loads persisted choices at launch without loading native storage in importers or tests. */
export function syncLocalPreviouslyRequestedHealthKit(): Promise<HealthKitAutoSyncResult> {
  if (pendingLocalRun) return pendingLocalRun;

  const run = syncLocalHealthKit();
  pendingLocalRun = run;
  const clear = () => {
    if (pendingLocalRun === run) pendingLocalRun = null;
  };
  void run.then(clear, clear);
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
): Promise<HealthKitAutoSyncConfigurationResult> {
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
    });
  } catch {
    // Storage setup failed before preferences could be saved, so Settings must retain dirty state.
    return { status: 'selection_save_failed', attemptedFeatures: [] };
  }
}

async function syncLocalHealthKit(): Promise<HealthKitAutoSyncResult> {
  try {
    const [{ healthKit }, { openLocalStorage }] = await Promise.all([
      import('.'),
      import('../storage/secureDatabase'),
    ]);
    const repository = await openLocalStorage();
    return runHealthKitAutoSync({
      repository,
      healthKit,
      now: () => new Date().toISOString(),
    });
  } catch {
    return { status: 'retryable', attemptedFeatures: [] };
  }
}
