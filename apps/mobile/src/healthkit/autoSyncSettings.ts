import type { RecordRepository } from '@orot/storage';
import type { HealthKitNativeModule } from './types';
import { runHealthKitAutoSync } from './autoSync';
import {
  healthKitAutoSyncFeatures,
  saveHealthKitAutoSyncSelection,
  saveHealthKitAutoSyncStatus,
} from './autoSyncCheckpoint';
import type { HealthKitAutoSyncFeature } from './autoSyncCheckpoint';

interface ConfigureHealthKitAutoSyncOptions {
  readonly repository: Pick<
    RecordRepository,
    'getSyncCheckpoint' | 'transaction'
  >;
  readonly healthKit: Pick<
    HealthKitNativeModule,
    'requestReadAuthorizations' | 'querySampleChanges'
  > &
    Partial<Pick<HealthKitNativeModule, 'queryMedicationDefinitions'>>;
  readonly now: () => string;
}

/** Saves opt-ins before consent so launch sync can retry if iOS access is unavailable. */
export async function configureHealthKitAutoSync(
  requested: readonly HealthKitAutoSyncFeature[],
  options: ConfigureHealthKitAutoSyncOptions,
) {
  const selected = healthKitAutoSyncFeatures.filter(feature =>
    requested.includes(feature),
  );
  try {
    await saveHealthKitAutoSyncSelection(
      options.repository,
      selected,
      options.now,
    );
    if (selected.length === 0) {
      return { status: 'skipped' as const, attemptedFeatures: [] };
    }

    const authorization =
      await options.healthKit.requestReadAuthorizations(selected);
    if (
      authorization.availability !== 'available' ||
      authorization.requestStatus !== 'completed'
    ) {
      await saveHealthKitAutoSyncStatus(
        options.repository,
        'retryable',
        options.now,
      );
      return { status: 'retryable' as const, attemptedFeatures: [] };
    }

    return await runHealthKitAutoSync(options);
  } catch {
    // Keep the requested categories for the Settings recovery action and next launch.
    try {
      await saveHealthKitAutoSyncStatus(
        options.repository,
        'retryable',
        options.now,
      );
    } catch {
      // A closed or unavailable encrypted store cannot retain this status yet.
    }
    return { status: 'retryable' as const, attemptedFeatures: [] };
  }
}
