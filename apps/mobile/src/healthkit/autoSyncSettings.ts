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
  | (HealthKitAutoSyncResult & {
      readonly authorizationFailure?: HealthKitAuthorizationFailure;
    })
  | {
      readonly status: 'selection_save_failed';
      readonly attemptedFeatures: readonly [];
    };

export interface HealthKitAuthorizationFailure {
  readonly stage:
    | 'availability'
    | 'standardRequest'
    | 'medicationRequest'
    | 'presentation'
    | 'authorization';
  readonly code:
    | 'healthDataUnavailable'
    | 'unsupportedFeature'
    | 'requestFailed'
    | 'presentationUnavailable';
}

/** The Settings screen keeps only a sanitized failure code, never native error text. */
export type HealthKitAutoSyncNotice = Pick<
  HealthKitAutoSyncConfigurationResult,
  'status'
> & {
  readonly authorizationFailure?: HealthKitAuthorizationFailure;
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

  let authorization;
  try {
    // Every explicit nonempty save repeats the selected request, even when the saved selection is unchanged.
    authorization = await options.healthKit.requestReadAuthorizations(selected);
  } catch (error) {
    await saveRetryableStatus(options);
    return {
      status: 'retryable',
      attemptedFeatures: [],
      authorizationFailure: mapAuthorizationFailure(error),
    };
  }

  if (authorization.availability !== 'available') {
    await saveRetryableStatus(options);
    return {
      status: 'retryable',
      attemptedFeatures: [],
      authorizationFailure: {
        stage: 'availability',
        code:
          authorization.availability === 'unsupportedFeature'
            ? 'unsupportedFeature'
            : 'healthDataUnavailable',
      },
    };
  }

  // Reviewing medication access may expose doses older than a saved anchor.
  // Explicit setup replays bounded dose pages; ordinary launch sync stays incremental.
  return refreshHealthKitAutoSyncSelection({
    ...options,
    refreshMedicationDoseHistory: selected.includes('medications'),
  });
}

async function saveRetryableStatus(
  options: ConfigureHealthKitAutoSyncOptions,
): Promise<void> {
  try {
    await saveHealthKitAutoSyncStatus(
      options.repository,
      'retryable',
      options.now,
    );
  } catch {
    // The saved selection remains retryable even when its aggregate status cannot be stored.
  }
}

function mapAuthorizationFailure(
  error: unknown,
): HealthKitAuthorizationFailure {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  switch (code) {
    case 'HEALTHKIT_AUTHORIZATION_STANDARD_REQUEST_FAILED':
      return { stage: 'standardRequest', code: 'requestFailed' };
    case 'HEALTHKIT_AUTHORIZATION_MEDICATION_REQUEST_FAILED':
      return { stage: 'medicationRequest', code: 'requestFailed' };
    case 'HEALTHKIT_AUTHORIZATION_PRESENTATION_UNAVAILABLE':
      return { stage: 'presentation', code: 'presentationUnavailable' };
    default:
      // Do not copy native descriptions into Settings, where they may vary by device or account.
      return { stage: 'authorization', code: 'requestFailed' };
  }
}
