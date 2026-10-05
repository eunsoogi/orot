export const healthKitFeatures = [
  'medications',
  'bloodPressure',
  'sleep',
  'heartRate',
  'steps',
  'bodyMass',
] as const;

export type HealthKitFeature = (typeof healthKitFeatures)[number];

export const healthKitSampleKinds = [
  'medicationDoseEvents',
  'bloodPressure',
  'sleep',
  'heartRate',
  'steps',
  'bodyMass',
] as const;

export type HealthKitSampleKind = (typeof healthKitSampleKinds)[number];

export type HealthKitDoseEventStatus =
  | 'notInteracted'
  | 'notificationNotSent'
  | 'snoozed'
  | 'taken'
  | 'skipped'
  | 'notLogged'
  | 'unknown';

export type HealthKitDoseScheduleType = 'asNeeded' | 'schedule' | 'unknown';

export interface HealthKitDeviceSnapshot {
  readonly manufacturer?: string;
  readonly model?: string;
  readonly hardwareVersion?: string;
  readonly softwareVersion?: string;
}

export interface HealthKitQuantitySourceRepresentation {
  readonly status: 'unavailable';
  readonly reason: 'healthkit_does_not_expose_original_display_unit';
}

export type HealthKitAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'unsupportedPlatform' };

// HealthKit keeps read grants opaque, so the public result cannot claim one.
export type HealthKitAuthorizationResult =
  | {
      readonly availability: 'available';
      readonly requestStatus: 'completed';
      readonly readAuthorization: 'notObservable';
    }
  | {
      readonly availability:
        'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
      readonly requestStatus: 'notRequested';
      readonly readAuthorization: 'notObservable';
    };

export interface HealthKitSampleSnapshot {
  readonly id: string;
  readonly typeIdentifier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly sourceVersion?: string;
  readonly sourceProductType?: string;
  readonly device?: HealthKitDeviceSnapshot;
  // value/unit are converted to Orot's query unit; HealthKit does not expose the entry display unit.
  readonly value?: number;
  readonly unit?: string;
  readonly sourceRepresentation?: HealthKitQuantitySourceRepresentation;
  readonly categoryValue?: number;
  readonly components?: readonly HealthKitSampleSnapshot[];
  readonly medicationConceptIdentifier?: string;
  readonly scheduledDate?: string;
  readonly doseQuantity?: number;
  readonly doseUnit?: string;
  readonly doseStatus?: number;
  readonly doseStatusName?: HealthKitDoseEventStatus;
  readonly scheduleType?: number;
  readonly scheduleTypeName?: HealthKitDoseScheduleType;
}

/** A cursor stays paired with the feature and sample kind that produced it. */
export interface HealthKitSampleChangesQuery {
  readonly feature: HealthKitFeature;
  readonly sampleKind: HealthKitSampleKind;
  readonly limit: number;
  readonly cursor: string | null;
}

/** Persist each page's additions, deletions, and cursor together before querying again. */
export type HealthKitSampleChangesResult =
  | {
      readonly availability: 'available';
      readonly status: 'completed';
      readonly readAuthorization: 'notObservable';
      readonly addedSamples: readonly HealthKitSampleSnapshot[];
      readonly deletedSampleIds: readonly string[];
      readonly cursor: string | null;
      readonly hasMore: boolean;
    }
  | {
      readonly availability:
        'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
      readonly status: 'notRun';
      readonly readAuthorization: 'notObservable';
    };

export type HealthKitSampleQueryResult =
  | {
      readonly availability: 'available';
      readonly status: 'completed';
      readonly readAuthorization: 'notObservable';
      readonly samples: readonly HealthKitSampleSnapshot[];
    }
  | {
      readonly availability:
        'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
      readonly status: 'notRun';
      readonly readAuthorization: 'notObservable';
    };

export interface HealthKitMedicationDefinitionSnapshot {
  readonly conceptIdentifier: string;
  readonly displayText: string;
  readonly generalForm: string;
  readonly nickname?: string;
  readonly isArchived: boolean;
  readonly hasSchedule: boolean;
}

export type HealthKitMedicationQueryResult =
  | {
      readonly availability: 'available';
      readonly status: 'completed';
      readonly readAuthorization: 'notObservable';
      readonly completeSnapshot: boolean;
      readonly medications: readonly HealthKitMedicationDefinitionSnapshot[];
    }
  | {
      readonly availability:
        'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
      readonly status: 'notRun';
      readonly readAuthorization: 'notObservable';
    };

export interface HealthKitSampleQuery {
  readonly feature: HealthKitFeature;
  readonly sampleKind: HealthKitSampleKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly limit: number;
}

export interface HealthKitNativeModule {
  getAvailability(): Promise<{ readonly status: 'available' | 'unavailable' }>;
  requestReadAuthorization(
    feature: HealthKitFeature,
  ): Promise<HealthKitAuthorizationResult>;
  querySamples(
    query: HealthKitSampleQuery,
  ): Promise<HealthKitSampleQueryResult>;
  queryMedicationDefinitions(
    limit: number,
  ): Promise<HealthKitMedicationQueryResult>;
  querySampleChanges(
    query: HealthKitSampleChangesQuery,
  ): Promise<HealthKitSampleChangesResult>;
}
