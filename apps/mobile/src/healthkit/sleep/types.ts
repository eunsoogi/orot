export const sleepAnalysisTypeIdentifier =
  'HKCategoryTypeIdentifierSleepAnalysis';

export type SleepStage =
  | 'inBed'
  | 'asleepUnspecified'
  | 'awake'
  | 'asleepCore'
  | 'asleepDeep'
  | 'asleepREM'
  | 'unsupported';

export type AsleepStage =
  'asleepUnspecified' | 'asleepCore' | 'asleepDeep' | 'asleepREM';

export interface SleepSourceRevision {
  readonly version?: string | null;
  readonly productType?: string | null;
}

export interface SleepDeviceMetadata {
  readonly name?: string | null;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly hardwareVersion?: string | null;
  readonly firmwareVersion?: string | null;
  readonly softwareVersion?: string | null;
  readonly localIdentifier?: string | null;
  readonly udiDeviceIdentifier?: string | null;
}

// Narrows common samples to sleep categories while retaining nullable sleep metadata.
export interface HealthKitSleepSampleSnapshot {
  readonly id: string;
  readonly typeIdentifier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly categoryValue: number;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly sourceVersion?: string | null;
  readonly sourceProductType?: string | null;
  // Preserve an omitted bridge field separately from explicit absence of a device.
  readonly device?: SleepDeviceMetadata | null;
  readonly timeZone?: string | null;
}

export interface SleepSourceMetadata {
  readonly identifier: string;
  readonly name: string;
  readonly revision?: SleepSourceRevision | null;
}

export interface SleepObservation {
  readonly id: string;
  readonly stage: SleepStage;
  readonly categoryValue: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly startEpochMs: number;
  readonly endEpochMs: number;
  readonly source: SleepSourceMetadata;
  readonly device?: SleepDeviceMetadata | null;
  readonly timeZone?: string | null;
}

export interface SleepSummaryRange {
  readonly fromDay: string;
  readonly throughDay: string;
  readonly timeZone: string;
}

export interface SleepDaySummary {
  readonly localDate: string;
  readonly timeZone: string;
  readonly status: 'observed' | 'noData';
  readonly sampleCount: number;
  readonly inBedDurationMs: number;
  readonly asleepDurationMs: number;
  readonly awakeDurationMs: number;
  readonly unclassifiedDurationMs: number;
  readonly stageDurationMs: Readonly<Record<AsleepStage, number>>;
}

export interface SleepImportState {
  readonly samples: readonly SleepObservation[];
  readonly anchor: string | null;
}

export interface SleepSyncChanges {
  readonly addedOrUpdated: readonly HealthKitSleepSampleSnapshot[];
  readonly deletedSampleIds: readonly string[];
  // A completed native query may have no anchor yet, represented explicitly as null.
  readonly nextAnchor: string | null;
  readonly complete: boolean;
}
