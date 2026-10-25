import type { RecordRepository } from '@orot/storage';
import type { HealthKitNativeModule } from './types';
import type { HealthKitAutoSyncResult } from './autoSync';
import { refreshHealthKitAutoSyncSelection } from './autoSync';
import {
  healthKitAutoSyncFeatures,
  saveHealthKitAutoSyncSelection,
  saveHealthKitAutoSyncStatus,
} from './autoSyncCheckpoint';
import type { HealthKitAutoSyncFeature } from './autoSyncCheckpoint';

export type HealthKitAutoSyncConfigurationResult =
  | HealthKitAutoSyncResult
  | {
      readonly status: 'selection_save_failed';
      readonly attemptedFeatures: readonly [];
    };

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
): Promise<HealthKitAutoSyncConfigurationResult> {
  const selected = healthKitAutoSyncFeatures.filter(feature =>
    requested.includes(feature),
  );
  try {
    await saveHealthKitAutoSyncSelection(
      options.repository,
      selected,
      options.now,
    );
  } catch {
    // A failed preference write is not a sync retry; the requested selection is still unsaved.
    return { status: 'selection_save_failed', attemptedFeatures: [] };
  }

  if (selected.length === 0) {
    return { status: 'skipped', attemptedFeatures: [] };
  }

  try {
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

    // Reviewing medication access may expose doses older than a saved anchor.
    // Explicit setup replays bounded dose pages; ordinary launch sync stays incremental.
    return await refreshHealthKitAutoSyncSelection({
      ...options,
      refreshMedicationDoseHistory: selected.includes('medications'),
    });
  } catch {
    // The selection is already stored, so only the aggregate sync status needs a retry marker.
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
