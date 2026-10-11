import type {
  HealthKitAuthorizationResult,
  HealthKitBatchAuthorizationResult,
  HealthKitNativeModule,
} from '../types';
import { requestHealthKitBatchAuthorization } from '../authorizationCoordinator';
import { syncCommonObservationChanges } from './sync';
import type {
  CommonObservationRepository,
  CommonObservationSyncStatus,
} from './sync';
import { commonObservationFeatures } from './types';
import type { CommonObservationFeature } from './types';

export type CommonObservationsImportStatus = CommonObservationSyncStatus;

export interface CommonObservationsImportResult {
  readonly status: CommonObservationsImportStatus;
  readonly readAuthorization: 'notObservable';
  readonly importedCount: number;
  readonly deletedCount: number;
  readonly unsupportedCount: number;
  readonly cursorAdvanced: boolean;
}

export interface ImportCommonObservationsOptions {
  readonly features: readonly CommonObservationFeature[];
  readonly healthKit: Pick<
    HealthKitNativeModule,
    'requestReadAuthorizations' | 'querySampleChanges'
  >;
  readonly repository: CommonObservationRepository;
  readonly now: () => string;
  readonly rememberForAutoSync?: boolean;
}

const pendingImports = new WeakMap<
  CommonObservationRepository,
  Map<string, Promise<CommonObservationsImportResult>>
>();

// Re-entry for one repository and selection must not race the same cursor commits.
/** Batches consent before per-feature sync while retaining independent source records. */
export function importCommonObservations(
  options: ImportCommonObservationsOptions,
): Promise<CommonObservationsImportResult> {
  let selected: CommonObservationFeature[];
  try {
    selected = selectFeatures(options.features);
  } catch (error) {
    return Promise.reject(error);
  }
  let inFlight = pendingImports.get(options.repository);
  if (!inFlight) {
    inFlight = new Map();
    pendingImports.set(options.repository, inFlight);
  }
  const key = selected.join(',');
  const pending = inFlight.get(key);
  if (pending) return pending;

  const operation = importSelectedFeatures(options, selected);
  inFlight.set(key, operation);
  const release = () => {
    if (inFlight?.get(key) !== operation) return;
    inFlight.delete(key);
    if (inFlight.size === 0) pendingImports.delete(options.repository);
  };
  operation.then(release, release);
  return operation;
}

async function importSelectedFeatures(
  options: ImportCommonObservationsOptions,
  selected: readonly CommonObservationFeature[],
): Promise<CommonObservationsImportResult> {
  if (selected.length === 0) return summarizeOutcomes([]);
  const authorization = await requestHealthKitBatchAuthorization({
    features: selected,
    healthKit: options.healthKit,
  });
  const outcomes = [];
  for (const feature of selected) {
    outcomes.push(
      await syncCommonObservationChanges({
        feature,
        authorization: authorizationForFeature(authorization, feature),
        healthKit: options.healthKit,
        repository: options.repository,
        now: options.now,
        ...(options.rememberForAutoSync
          ? { rememberForAutoSync: true as const }
          : {}),
      }),
    );
  }

  return summarizeOutcomes(outcomes);
}

function summarizeOutcomes(
  outcomes: readonly Awaited<ReturnType<typeof syncCommonObservationChanges>>[],
): CommonObservationsImportResult {
  const failed = outcomes.filter(
    outcome => outcome.status !== 'complete' && outcome.status !== 'empty',
  );
  let status: CommonObservationsImportStatus;
  if (failed.length > 0) {
    status = onlyOneFailure(outcomes, failed)
      ? (failed[0]?.status ?? 'partial')
      : 'partial';
  } else if (
    outcomes.some(outcome => outcome.upserted > 0 || outcome.deleted > 0)
  ) {
    status = 'complete';
  } else {
    status = 'empty';
  }

  return {
    status,
    readAuthorization: 'notObservable',
    importedCount: outcomes.reduce(
      (total, outcome) => total + outcome.upserted,
      0,
    ),
    deletedCount: outcomes.reduce(
      (total, outcome) => total + outcome.deleted,
      0,
    ),
    unsupportedCount: outcomes.reduce(
      (total, outcome) => total + outcome.skipped,
      0,
    ),
    cursorAdvanced: outcomes.some(outcome => outcome.cursorAdvanced),
  };
}

function authorizationForFeature(
  batch: HealthKitBatchAuthorizationResult,
  feature: CommonObservationFeature,
): HealthKitAuthorizationResult {
  if (batch.availability === 'available') {
    return batch.unsupportedFeatures.includes(feature)
      ? {
          availability: 'unsupportedFeature',
          requestStatus: 'notRequested',
          readAuthorization: 'notObservable',
        }
      : {
          availability: 'available',
          requestStatus: 'completed',
          readAuthorization: 'notObservable',
        };
  }
  return {
    availability: batch.availability,
    requestStatus: 'notRequested',
    readAuthorization: 'notObservable',
  };
}

function selectFeatures(
  features: readonly CommonObservationFeature[],
): CommonObservationFeature[] {
  const selected = new Set(features);
  if (
    selected.size !== features.length ||
    [...selected].some(feature => !commonObservationFeatures.includes(feature))
  ) {
    throw new Error('Common HealthKit observation selection is invalid.');
  }
  return commonObservationFeatures.filter(feature => selected.has(feature));
}

function onlyOneFailure(
  outcomes: readonly { readonly status: CommonObservationSyncStatus }[],
  failed: readonly { readonly status: CommonObservationSyncStatus }[],
): boolean {
  return (
    outcomes.length === 1 ||
    (outcomes.length === failed.length &&
      failed.every(outcome => outcome.status === failed[0]?.status))
  );
}
