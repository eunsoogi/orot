import { parseRecord } from '@orot/storage';
import type { HealthKitSampleSnapshot } from '../types';
import {
  bloodPressureObservationId,
  bloodPressureSampleTypeIdentifiers,
  type BloodPressureComponent,
  type BloodPressureMappedCorrelation,
  type BloodPressureObservation,
} from './types';
import { normalizeBloodPressureValue } from './units';

const componentTypeIdentifiers: Record<BloodPressureComponent, string> = {
  systolic: bloodPressureSampleTypeIdentifiers.systolic,
  diastolic: bloodPressureSampleTypeIdentifiers.diastolic,
};

const unavailableSourceRepresentation = {
  status: 'unavailable',
  reason: 'healthkit_does_not_expose_original_display_unit',
} as const;

/** Keeps component times exact and marks HealthKit's unavailable original display unit. */
export function mapBloodPressureCorrelation(
  correlation: HealthKitSampleSnapshot,
  ingestedAt: string,
): BloodPressureMappedCorrelation {
  requireNonEmpty(correlation.id, 'correlation id');
  if (
    correlation.typeIdentifier !==
    bloodPressureSampleTypeIdentifiers.correlation
  ) {
    throw new Error('A blood-pressure correlation type is required.');
  }

  const components = correlation.components ?? [];
  return {
    correlationId: correlation.id,
    observations: (['systolic', 'diastolic'] as const).flatMap(component => {
      const observation = mapComponent(
        correlation,
        components,
        component,
        ingestedAt,
      );
      return observation ? [observation] : [];
    }),
  };
}

/** Returns no row for a missing quantity so it cannot become a healthy-value inference. */
function mapComponent(
  correlation: HealthKitSampleSnapshot,
  components: readonly HealthKitSampleSnapshot[],
  component: BloodPressureComponent,
  ingestedAt: string,
): BloodPressureObservation | null {
  const typeIdentifier = componentTypeIdentifiers[component];
  const matches = components.filter(
    sample => sample.typeIdentifier === typeIdentifier,
  );
  if (matches.length > 1) {
    throw new Error(
      'A blood-pressure correlation has duplicate ' +
        component +
        ' components.',
    );
  }
  const sample = matches[0];
  if (!sample) return null;
  requireNonEmpty(sample.id, component + ' sample id');
  if (sample.value === undefined || !nonEmpty(sample.unit)) {
    throw new Error(
      'A blood-pressure component must include a value and unit.',
    );
  }

  const normalized = normalizeBloodPressureValue(sample.value, sample.unit);
  const sourceIdentifier = nonEmpty(sample.sourceIdentifier)
    ? sample.sourceIdentifier
    : correlation.sourceIdentifier;
  const sourceName = nonEmpty(sample.sourceName)
    ? sample.sourceName
    : correlation.sourceName;
  const sourceVersion = nonEmpty(sample.sourceVersion)
    ? sample.sourceVersion
    : correlation.sourceVersion;
  const productType = nonEmpty(sample.sourceProductType)
    ? sample.sourceProductType
    : correlation.sourceProductType;
  const device = deviceMetadata(sample.device ?? correlation.device);
  const sourceRecordIds = [...new Set([correlation.id, sample.id])];

  return parseRecord('health_observation', {
    id: bloodPressureObservationId(correlation.id, component),
    effectiveAt: sample.startDate,
    endedAt: sample.endDate,
    ingestedAt,
    provenance: {
      origin: 'imported',
      sourceRecordIds,
      source: {
        system: 'healthkit',
        ...(nonEmpty(sourceIdentifier) ? { sourceIdentifier } : {}),
        ...(nonEmpty(sourceName) ? { sourceName } : {}),
        ...(nonEmpty(sourceVersion) ? { sourceVersion } : {}),
        ...(nonEmpty(productType) ? { productType } : {}),
        ...(device ? { device } : {}),
      },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'blood pressure ' + component,
    value: {
      kind: 'quantity',
      amount: normalized.value,
      unit: normalized.unit,
      sourceRepresentation:
        sample.sourceRepresentation ?? unavailableSourceRepresentation,
    },
  });
}

function deviceMetadata(
  device: HealthKitSampleSnapshot['device'],
): HealthKitSampleSnapshot['device'] | undefined {
  if (!device) return undefined;
  const result = {
    ...(nonEmpty(device.manufacturer)
      ? { manufacturer: device.manufacturer }
      : {}),
    ...(nonEmpty(device.model) ? { model: device.model } : {}),
    ...(nonEmpty(device.hardwareVersion)
      ? { hardwareVersion: device.hardwareVersion }
      : {}),
    ...(nonEmpty(device.softwareVersion)
      ? { softwareVersion: device.softwareVersion }
      : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmpty(value: string, field: string): void {
  if (!nonEmpty(value))
    throw new Error('A blood-pressure ' + field + ' is required.');
}
