import type { HealthKitNativeModule } from '../types';
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
    'requestReadAuthorization' | 'querySampleChanges'
  >;
  readonly repository: CommonObservationRepository;
  readonly now: () => string;
}

/** Imports only selected types and leaves HealthKit samples as separate source records. */
export async function importCommonObservations(
  options: ImportCommonObservationsOptions,
): Promise<CommonObservationsImportResult> {
  const selected = selectFeatures(options.features);
  const outcomes = [];
  for (const feature of selected) {
    outcomes.push(
      await syncCommonObservationChanges({
        feature,
        healthKit: options.healthKit,
        repository: options.repository,
        now: options.now,
      }),
    );
  }

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
