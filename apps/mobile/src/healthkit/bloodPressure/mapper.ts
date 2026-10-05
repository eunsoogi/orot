import { normalizeBloodPressureValue } from './units';
import {
  bloodPressureSampleTypeIdentifiers,
  type BloodPressureComponent,
  type BloodPressureCorrelationSnapshot,
  type BloodPressureObservation,
  type BloodPressureQuantitySnapshot,
  type BloodPressureReading,
} from './types';

const componentTypeIdentifiers: Record<BloodPressureComponent, string> = {
  systolic: bloodPressureSampleTypeIdentifiers.systolic,
  diastolic: bloodPressureSampleTypeIdentifiers.diastolic,
};

/**
 * Maps one HealthKit correlation without changing its timestamp strings. Missing
 * components stay explicit so an incomplete pair can never become a normal value.
 */
export function mapBloodPressureCorrelation(
  correlation: BloodPressureCorrelationSnapshot,
): BloodPressureObservation {
  requireNonEmpty(correlation.id, 'correlation id');
  requireNonEmpty(correlation.startDate, 'correlation start date');
  requireNonEmpty(correlation.endDate, 'correlation end date');
  requireNonEmpty(
    correlation.sourceIdentifier,
    'correlation source identifier',
  );
  requireNonEmpty(correlation.sourceName, 'correlation source name');
  if (
    correlation.typeIdentifier !==
    bloodPressureSampleTypeIdentifiers.correlation
  ) {
    throw new Error('A blood-pressure correlation type is required.');
  }

  const components = correlation.components ?? [];
  return {
    id: correlation.id,
    startDate: correlation.startDate,
    endDate: correlation.endDate,
    sourceIdentifier: correlation.sourceIdentifier,
    sourceName: correlation.sourceName,
    ...(correlation.device ? { device: correlation.device } : {}),
    provenance: {
      origin: 'imported',
      sourceSystem: 'HealthKit',
      sourceSampleId: correlation.id,
      sourceIdentifier: correlation.sourceIdentifier,
      sourceName: correlation.sourceName,
    },
    systolic: mapComponent(components, 'systolic'),
    diastolic: mapComponent(components, 'diastolic'),
  };
}

function mapComponent(
  components: readonly BloodPressureQuantitySnapshot[],
  component: BloodPressureComponent,
): BloodPressureReading | null {
  const typeIdentifier = componentTypeIdentifiers[component];
  const matches = components.filter(
    sample => sample.typeIdentifier === typeIdentifier,
  );
  if (matches.length > 1) {
    throw new Error(
      `A blood-pressure correlation has duplicate ${component} components.`,
    );
  }
  const sample = matches[0];
  if (!sample) return null;

  requireNonEmpty(sample.id, `${component} sample id`);
  requireNonEmpty(sample.startDate, `${component} start date`);
  requireNonEmpty(sample.endDate, `${component} end date`);
  requireNonEmpty(sample.sourceIdentifier, `${component} source identifier`);
  requireNonEmpty(sample.sourceName, `${component} source name`);
  const normalized = normalizeBloodPressureValue(
    sample.originalValue,
    sample.originalUnit,
  );

  return {
    sampleId: sample.id,
    startDate: sample.startDate,
    endDate: sample.endDate,
    sourceIdentifier: sample.sourceIdentifier,
    sourceName: sample.sourceName,
    ...(sample.device ? { device: sample.device } : {}),
    originalValue: normalized.originalValue,
    originalUnit: normalized.originalUnit,
    normalizedValue: normalized.value,
    normalizedUnit: 'mmHg',
  };
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0)
    throw new Error(`A blood-pressure ${field} is required.`);
}
