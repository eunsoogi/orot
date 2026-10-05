import type { HealthKitSampleSnapshot } from '../types';
import type { RecordMap } from '@orot/storage';

export const commonObservationFeatures = [
  'heartRate',
  'steps',
  'bodyMass',
] as const;

export type CommonObservationFeature =
  (typeof commonObservationFeatures)[number];

export type CommonObservationUnit = 'count/min' | 'count' | 'kg';
export type CommonObservationConcept =
  'heart_rate' | 'step_count' | 'body_mass';
export type CommonObservationQuantityValue = Extract<
  RecordMap['health_observation']['value'],
  { readonly kind: 'quantity' }
>;

/** Keeps source timing and identity alongside a normalized health observation. */
export interface MappedCommonObservation {
  readonly feature: CommonObservationFeature;
  readonly recordId: string;
  readonly observationKind: 'measurement';
  readonly concept: CommonObservationConcept;
  readonly value: CommonObservationQuantityValue;
  readonly sourceSampleId: string;
  readonly typeIdentifier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceIdentifier: string;
  readonly sourceName: string;
  readonly sourceVersion?: string;
  readonly sourceProductType?: string;
  readonly device?: HealthKitSampleSnapshot['device'];
}

export type CommonObservationMappingReason =
  | 'wrongSampleType'
  | 'missingIdentity'
  | 'invalidTimeRange'
  | 'missingValue'
  | 'invalidValue'
  | 'missingUnit'
  | 'unsupportedUnit';

export type CommonObservationMappingResult =
  | { readonly status: 'mapped'; readonly observation: MappedCommonObservation }
  | {
      readonly status: 'skipped';
      readonly reason: CommonObservationMappingReason;
    };

export type CommonObservationMapperInput = HealthKitSampleSnapshot;
