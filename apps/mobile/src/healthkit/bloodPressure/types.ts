import type { RecordMap, RecordRepository } from '@orot/storage';
import type {
  HealthKitAuthorizationResult,
  HealthKitNativeModule,
  HealthKitSampleChangesResult,
} from '../types';

export const bloodPressureSampleTypeIdentifiers = {
  correlation: 'HKCorrelationTypeIdentifierBloodPressure',
  systolic: 'HKQuantityTypeIdentifierBloodPressureSystolic',
  diastolic: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
} as const;

export type BloodPressureComponent = 'systolic' | 'diastolic';
export type BloodPressureObservation = RecordMap['health_observation'];
export interface BloodPressureMappedCorrelation {
  readonly correlationId: string;
  readonly observations: readonly BloodPressureObservation[];
}
export type BloodPressureChangePage = Extract<
  HealthKitSampleChangesResult,
  { readonly status: 'completed' }
>;

export type BloodPressureHealthKitClient = Pick<
  HealthKitNativeModule,
  'requestReadAuthorization' | 'querySampleChanges'
>;

export type BloodPressureRepository = Pick<
  RecordRepository,
  'getSyncCheckpoint' | 'transaction'
>;

interface BloodPressureSyncSharedOptions {
  readonly repository: BloodPressureRepository;
  readonly now: () => string;
}

/** A selected batch may pass its result; standalone screens still request one feature. */
export type BloodPressureSyncOptions = BloodPressureSyncSharedOptions &
  (
    | {
        readonly authorization: HealthKitAuthorizationResult;
        readonly healthKit: Pick<HealthKitNativeModule, 'querySampleChanges'>;
      }
    | {
        readonly authorization?: undefined;
        readonly healthKit: BloodPressureHealthKitClient;
      }
  );

export interface BloodPressureSyncResult {
  readonly status: 'completed' | 'notRun' | 'partial';
  readonly readAuthorization: 'notObservable';
  readonly upserted: number;
  readonly deleted: number;
  readonly cursorAdvanced: boolean;
}

/** Correlation-based IDs let one HealthKit deletion remove both pressure values. */
export function bloodPressureObservationId(
  correlationId: string,
  component: BloodPressureComponent,
): string {
  return (
    'healthkit-blood-pressure:' + correlationId.toLowerCase() + ':' + component
  );
}
