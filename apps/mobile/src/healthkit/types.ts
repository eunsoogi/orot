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
  readonly value?: number;
  readonly unit?: string;
  readonly categoryValue?: number;
  readonly components?: readonly HealthKitSampleSnapshot[];
  readonly medicationConceptIdentifier?: string;
  readonly doseQuantity?: number;
  readonly doseUnit?: string;
  readonly doseStatus?: number;
  readonly scheduleType?: number;
}

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
}
