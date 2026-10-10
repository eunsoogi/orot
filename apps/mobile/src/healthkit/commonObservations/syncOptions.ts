import type { RecordRepository } from '@orot/storage';
import type {
  HealthKitAuthorizationResult,
  HealthKitNativeModule,
} from '../types';
import type { CommonObservationFeature } from './types';

export type CommonObservationRepository = Pick<
  RecordRepository,
  'getSyncCheckpoint' | 'transaction'
>;

export type CommonObservationSyncStatus =
  | 'complete'
  | 'empty'
  | 'unavailable'
  | 'unsupportedFeature'
  | 'unsupportedPlatform'
  | 'unsupportedData'
  | 'partial';

export interface CommonObservationSyncResult {
  readonly status: CommonObservationSyncStatus;
  readonly readAuthorization: 'notObservable';
  readonly upserted: number;
  readonly deleted: number;
  readonly skipped: number;
  readonly cursorAdvanced: boolean;
}

export interface CommonObservationInstrumentation {
  query<T>(operation: () => Promise<T>): Promise<T>;
  persist<T>(operation: () => Promise<T>): Promise<T>;
}

/** Measures a sync phase without wrapping the repository identity used for serialization. */
export function measureCommonObservationOperation<T>(
  instrumentation: CommonObservationInstrumentation | undefined,
  phase: 'query' | 'persist',
  operation: () => Promise<T>,
): Promise<T> {
  if (!instrumentation) return operation();
  return phase === 'query'
    ? instrumentation.query(operation)
    : instrumentation.persist(operation);
}

/** A batch caller supplies authorization after consent; standalone sync requests one feature. */
interface SyncCommonObservationChangesSharedOptions {
  readonly feature: CommonObservationFeature;
  readonly repository: CommonObservationRepository;
  /** Observes phases without replacing the repository object used for its lock. */
  readonly instrumentation?: CommonObservationInstrumentation;
  readonly now: () => string;
}

export type SyncCommonObservationChangesOptions =
  SyncCommonObservationChangesSharedOptions &
    (
      | {
          readonly authorization: HealthKitAuthorizationResult;
          readonly healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'>;
        }
      | {
          readonly authorization?: undefined;
          readonly healthKit: Pick<
            HealthKitNativeModule,
            'requestReadAuthorization' | 'querySampleChanges'
          >;
        }
    );
