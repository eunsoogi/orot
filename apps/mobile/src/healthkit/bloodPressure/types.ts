import type { RecordMap, RecordRepository } from '@orot/storage';
import type {
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
  'querySampleChanges'
>;

export type BloodPressureRepository = Pick<
  RecordRepository,
  'getSyncCheckpoint' | 'transaction'
>;

export interface BloodPressureSyncOptions {
  readonly healthKit: BloodPressureHealthKitClient;
  readonly repository: BloodPressureRepository;
  readonly now: () => string;
}

export interface BloodPressureSyncResult {
  readonly status: 'completed' | 'notRun' | 'partial';
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
