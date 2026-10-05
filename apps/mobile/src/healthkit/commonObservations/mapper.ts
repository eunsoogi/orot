import type {
  CommonObservationFeature,
  CommonObservationConcept,
  CommonObservationMappingResult,
  CommonObservationMapperInput,
  CommonObservationUnit,
} from './types';
import { compareHealthKitTimestamps, isValidHealthKitTimestamp } from './time';

const sampleDefinitions: Record<
  CommonObservationFeature,
  {
    readonly typeIdentifier: string;
    readonly concept: CommonObservationConcept;
    readonly unit: CommonObservationUnit;
  }
> = {
  heartRate: {
    typeIdentifier: 'HKQuantityTypeIdentifierHeartRate',
    concept: 'heart_rate',
    unit: 'count/min',
  },
  steps: {
    typeIdentifier: 'HKQuantityTypeIdentifierStepCount',
    concept: 'step_count',
    unit: 'count',
  },
  bodyMass: {
    typeIdentifier: 'HKQuantityTypeIdentifierBodyMass',
    concept: 'body_mass',
    unit: 'kg',
  },
};

/** Rebuilds deleted-record keys from HealthKit's sample ID-only change events. */
export function commonObservationRecordId(
  feature: CommonObservationFeature,
  sourceSampleId: string,
): string {
  return `healthkit:${feature}:${encodeURIComponent(sourceSampleId)}`;
}

/** Maps canonical quantities while preserving identity, interval and source metadata. */
export function mapCommonObservationSample(
  feature: CommonObservationFeature,
  sample: CommonObservationMapperInput,
): CommonObservationMappingResult {
  const definition = sampleDefinitions[feature];
  if (sample.typeIdentifier !== definition.typeIdentifier) {
    return { status: 'skipped', reason: 'wrongSampleType' };
  }
  if (
    !isNonEmpty(sample.id) ||
    !isNonEmpty(sample.sourceIdentifier) ||
    typeof sample.sourceName !== 'string'
  ) {
    return { status: 'skipped', reason: 'missingIdentity' };
  }
  if (
    !isValidHealthKitTimestamp(sample.startDate) ||
    !isValidHealthKitTimestamp(sample.endDate)
  ) {
    return { status: 'skipped', reason: 'invalidTimeRange' };
  }
  if (compareHealthKitTimestamps(sample.startDate, sample.endDate) > 0) {
    return { status: 'skipped', reason: 'invalidTimeRange' };
  }
  // Snapshots keep quantity fields optional; missing evidence is not numeric zero.
  if (sample.value === undefined) {
    return { status: 'skipped', reason: 'missingValue' };
  }
  if (
    typeof sample.value !== 'number' ||
    !Number.isFinite(sample.value) ||
    sample.value < 0
  ) {
    return { status: 'skipped', reason: 'invalidValue' };
  }
  if (sample.unit === undefined || sample.unit.trim().length === 0) {
    return { status: 'skipped', reason: 'missingUnit' };
  }
  if (sample.unit !== definition.unit) {
    return { status: 'skipped', reason: 'unsupportedUnit' };
  }

  return {
    status: 'mapped',
    observation: {
      feature,
      recordId: commonObservationRecordId(feature, sample.id),
      observationKind: 'measurement',
      concept: definition.concept,
      value: { kind: 'quantity', amount: sample.value, unit: definition.unit },
      sourceSampleId: sample.id,
      typeIdentifier: sample.typeIdentifier,
      startDate: sample.startDate,
      endDate: sample.endDate,
      sourceIdentifier: sample.sourceIdentifier,
      sourceName: sample.sourceName,
    },
  };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
