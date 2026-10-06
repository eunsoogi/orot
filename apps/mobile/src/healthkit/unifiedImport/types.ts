import type { CalendarImportBridge } from '../../calendar/types';
import type {
  HealthKitAuthorizationResult,
  HealthKitFeature,
  HealthKitNativeModule,
} from '../types';
import type { RecordRepository } from '@orot/storage';

export type UnifiedFeatureStatus =
  | 'notSelected'
  | 'waitingAuthorization'
  | 'ready'
  | 'querying'
  | 'persisting'
  | 'complete'
  | 'empty'
  | 'partial'
  | 'unsupportedFeature'
  | 'unsupportedPlatform'
  | 'unavailable'
  | 'unsupportedData'
  | 'notRun'
  | 'failed'
  | 'cancelled';

export type UnifiedCalendarStatus =
  | 'notSelected'
  | 'waitingAuthorization'
  | 'fullAccess'
  | 'querying'
  | 'complete'
  | 'empty'
  | 'writeOnly'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'failed'
  | 'cancelled';

export type UnifiedImportStatus =
  | 'queued'
  | 'authorizingHealthKit'
  | 'authorizingEventKit'
  | 'preparingStorage'
  | 'querying'
  | 'cancelling'
  | 'complete'
  | 'empty'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type UnifiedMeasurementProvider =
  'healthKit' | 'eventKit' | 'localStore';
export type UnifiedMeasurementPhase =
  'authorization' | 'permissionRequestInvocation' | 'query' | 'persistence';

/** Uses relative monotonic offsets and durations only; never attach record data or wall time. */
export interface UnifiedImportMeasurement {
  readonly provider: UnifiedMeasurementProvider;
  readonly phase: UnifiedMeasurementPhase;
  readonly transition: 'started' | 'invoked' | 'finished';
  readonly offsetMs: number;
  readonly durationMs?: number;
  readonly outcome?: 'completed' | 'failed';
}

export interface UnifiedFeatureProgress {
  readonly status: UnifiedFeatureStatus;
  readonly importedCount: number | null;
  readonly deletedCount: number | null;
}

export interface UnifiedImportProgress {
  readonly phase: UnifiedImportStatus;
  readonly features: Readonly<Record<HealthKitFeature, UnifiedFeatureProgress>>;
  readonly calendar: {
    readonly status: UnifiedCalendarStatus;
    readonly eventCount: number | null;
  };
}

export interface UnifiedImportSelection {
  readonly healthKitFeatures: readonly HealthKitFeature[];
  readonly calendar: boolean;
}

export type UnifiedFeatureOutcomeStatus = Exclude<
  UnifiedFeatureStatus,
  'notSelected' | 'waitingAuthorization' | 'ready' | 'querying' | 'persisting'
>;

export interface UnifiedFeatureOutcome {
  readonly status: UnifiedFeatureOutcomeStatus;
  readonly importedCount: number | null;
  readonly deletedCount: number | null;
}

export interface UnifiedFeatureInstrumentation {
  query<T>(operation: () => Promise<T>): Promise<T>;
  persist<T>(operation: () => Promise<T>): Promise<T>;
}

/** Injected feature adapter keeps consent ordering testable without HealthKit data. */
export interface UnifiedImportServices {
  readonly healthKit: Pick<HealthKitNativeModule, 'requestReadAuthorizations'>;
  readonly calendar: CalendarImportBridge;
  readonly openRepository: () => Promise<RecordRepository>;
  readonly runFeature: (
    feature: HealthKitFeature,
    authorization: HealthKitAuthorizationResult,
    repository: RecordRepository,
    instrumentation: UnifiedFeatureInstrumentation,
  ) => Promise<UnifiedFeatureOutcome>;
  readonly monotonicNow?: () => number;
}

export interface UnifiedImportListeners {
  readonly onProgress?: (progress: UnifiedImportProgress) => void;
  readonly onMeasurement?: (measurement: UnifiedImportMeasurement) => void;
}

export interface UnifiedImportResult {
  readonly status: Exclude<
    UnifiedImportStatus,
    | 'queued'
    | 'authorizingHealthKit'
    | 'authorizingEventKit'
    | 'preparingStorage'
    | 'querying'
    | 'cancelling'
  >;
  readonly readAuthorization: 'notObservable';
  readonly progress: UnifiedImportProgress;
  readonly measurements: readonly UnifiedImportMeasurement[];
}

export interface UnifiedImportRun {
  readonly result: Promise<UnifiedImportResult>;
  /** Stops before the next feature; an active HealthKit page remains atomic. */
  cancel(): void;
}
