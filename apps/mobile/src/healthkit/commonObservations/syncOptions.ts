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

/** A batch caller supplies authorization after consent; standalone sync requests one feature. */
interface SyncCommonObservationChangesSharedOptions {
  readonly feature: CommonObservationFeature;
  readonly repository: CommonObservationRepository;
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
