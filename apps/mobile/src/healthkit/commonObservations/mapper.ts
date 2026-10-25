import { parseRecord } from '@orot/storage';
import type { RecordMap } from '@orot/storage';
import type {
  CommonObservationFeature,
  CommonObservationConcept,
  CommonObservationMappingResult,
  CommonObservationMapperInput,
  CommonObservationUnit,
  MappedCommonObservation,
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
  const device = deviceMetadata(sample.device);

  return {
    status: 'mapped',
    observation: {
      feature,
      recordId: commonObservationRecordId(feature, sample.id),
      observationKind: 'measurement',
      concept: definition.concept,
      value: {
        kind: 'quantity',
        amount: sample.value,
        unit: definition.unit,
        // HealthKit returns normalized query units but not each entry's display unit.
        sourceRepresentation: sample.sourceRepresentation ?? {
          status: 'unavailable',
          reason: 'healthkit_does_not_expose_original_display_unit',
        },
      },
      sourceSampleId: sample.id,
      typeIdentifier: sample.typeIdentifier,
      startDate: sample.startDate,
      endDate: sample.endDate,
      sourceIdentifier: sample.sourceIdentifier,
      sourceName: sample.sourceName,
      ...(isNonEmpty(sample.sourceVersion)
        ? { sourceVersion: sample.sourceVersion }
        : {}),
      ...(isNonEmpty(sample.sourceProductType)
        ? { sourceProductType: sample.sourceProductType }
        : {}),
      ...(device ? { device } : {}),
    },
  };
}

/** Converts a valid sample mapping to the existing local health record schema. */
export function toCommonObservationRecord(
  observation: MappedCommonObservation,
  ingestedAt: string,
): RecordMap['health_observation'] {
  const device = deviceMetadata(observation.device);
  const source = {
    system: 'healthkit',
    sourceIdentifier: observation.sourceIdentifier,
    ...(isNonEmpty(observation.sourceName)
      ? { sourceName: observation.sourceName }
      : {}),
    ...(isNonEmpty(observation.sourceVersion)
      ? { sourceVersion: observation.sourceVersion }
      : {}),
    ...(isNonEmpty(observation.sourceProductType)
      ? { productType: observation.sourceProductType }
      : {}),
    ...(device ? { device } : {}),
  };

  // HealthKit snapshots do not include creationDate; leave recordedAt absent instead of inventing source time.
  return parseRecord('health_observation', {
    id: observation.recordId,
    effectiveAt: observation.startDate,
    endedAt: observation.endDate,
    ingestedAt,
    provenance: {
      origin: 'imported',
      sourceRecordIds: [observation.sourceSampleId],
      source,
    },
    reviewState: { status: 'unreviewed' },
    observationKind: observation.observationKind,
    concept: observation.concept,
    value: observation.value,
  });
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function deviceMetadata(
  device: MappedCommonObservation['device'],
): MappedCommonObservation['device'] | undefined {
  if (!device) return undefined;
  const result = {
    ...(isNonEmpty(device.manufacturer)
      ? { manufacturer: device.manufacturer }
      : {}),
    ...(isNonEmpty(device.model) ? { model: device.model } : {}),
    ...(isNonEmpty(device.hardwareVersion)
      ? { hardwareVersion: device.hardwareVersion }
      : {}),
    ...(isNonEmpty(device.softwareVersion)
      ? { softwareVersion: device.softwareVersion }
      : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}
