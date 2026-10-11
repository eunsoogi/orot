import type { HealthKitAutoSyncResult } from './autoSync';
import { runHealthKitAutoSync } from './autoSync';

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
