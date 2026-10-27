import { healthKit } from '../healthkit';
import { loadLocalHealthKitAutoSyncStatus } from '../healthkit/autoSyncLocal';

type LastSyncSnapshot = Awaited<
  ReturnType<typeof loadLocalHealthKitAutoSyncStatus>
>;

export interface HealthDataIntegrationStatus {
  readonly availability: 'available' | 'unavailable' | 'unknown';
  readonly lastSync: LastSyncSnapshot;
  readonly statusLoadFailed: boolean;
}

/** Reads HealthKit availability and aggregate sync metadata without requesting consent or samples. */
export async function loadHealthDataIntegrationStatus(): Promise<HealthDataIntegrationStatus> {
  try {
    const [availability, lastSync] = await Promise.allSettled([
      healthKit.getAvailability(),
      loadLocalHealthKitAutoSyncStatus(),
    ]);
    return {
      // A known unsupported platform is unavailable; only a failed read is unknown.
      availability:
        availability.status === 'fulfilled'
          ? availability.value.status === 'unsupportedPlatform'
            ? 'unavailable'
            : availability.value.status
          : 'unknown',
      lastSync: lastSync.status === 'fulfilled' ? lastSync.value : null,
      statusLoadFailed:
        availability.status === 'rejected' || lastSync.status === 'rejected',
    };
  } catch {
    return {
      availability: 'unknown',
      lastSync: null,
      statusLoadFailed: true,
    };
  }
}
