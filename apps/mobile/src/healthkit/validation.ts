import type {
  HealthKitAuthorizationResult,
  HealthKitAvailability,
  HealthKitFeature,
  HealthKitMedicationQueryResult,
  HealthKitSampleKind,
  HealthKitSampleQuery,
  HealthKitSampleQueryResult,
} from './types';
import { healthKitFeatures, healthKitSampleKinds } from './types';

// Keep each named feature bound to only its own sample-kind choices.
const sampleKindByFeature: Record<
  HealthKitFeature,
  readonly HealthKitSampleKind[]
> = {
  medications: ['medicationDoseEvents'],
  bloodPressure: ['bloodPressure'],
  sleep: ['sleep'],
  heartRate: ['heartRate'],
  steps: ['steps'],
  bodyMass: ['bodyMass'],
};

export function validateSampleQuery(query: HealthKitSampleQuery): void {
  if (!query || typeof query !== 'object') {
    throw codedError(
      'INVALID_REQUEST',
      'A HealthKit sample query is required.',
    );
  }
  assertFeature(query.feature);
  if (!healthKitSampleKinds.includes(query.sampleKind)) {
    throw codedError(
      'UNSUPPORTED_SAMPLE_KIND',
      'HealthKit sample kind is unsupported.',
    );
  }
  if (!sampleKindByFeature[query.feature].includes(query.sampleKind)) {
    throw codedError(
      'FEATURE_SAMPLE_MISMATCH',
      'Sample kind does not belong to the requested feature.',
    );
  }
  validateDateRange(query.startDate, query.endDate);
  validateLimit(query.limit);
}

export function assertFeature(
  value: unknown,
): asserts value is HealthKitFeature {
  if (!healthKitFeatures.includes(value as HealthKitFeature)) {
    throw codedError(
      'UNSUPPORTED_FEATURE',
      'HealthKit feature is unsupported.',
    );
  }
}

function validateDateRange(startDate: string, endDate: string): void {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end
  ) {
    throw codedError(
      'INVALID_DATE_RANGE',
      'HealthKit queries need a valid ordered date range.',
    );
  }
}

export function validateLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw codedError(
      'INVALID_LIMIT',
      'HealthKit query limit must be between 1 and 500.',
    );
  }
}

export function requireAvailability(value: unknown): HealthKitAvailability {
  if (
    isRecord(value) &&
    (value.status === 'available' || value.status === 'unavailable')
  ) {
    return { status: value.status };
  }
  throw codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit availability response is invalid.',
  );
}

export function requireAuthorizationResult(
  value: unknown,
): HealthKitAuthorizationResult {
  if (!isRecord(value) || value.readAuthorization !== 'notObservable') {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit read authorization must remain unobservable.',
    );
  }
  if (
    value.availability === 'available' &&
    value.requestStatus === 'completed'
  ) {
    return {
      availability: 'available',
      requestStatus: value.requestStatus,
      readAuthorization: 'notObservable',
    };
  }
  if (
    isUnavailable(value.availability) &&
    value.requestStatus === 'notRequested'
  ) {
    return {
      availability: value.availability,
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
    };
  }
  throw codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit request status is invalid.',
  );
}

export function requireSampleQueryResult(
  value: unknown,
): HealthKitSampleQueryResult {
  if (!isRecord(value) || value.readAuthorization !== 'notObservable') {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit query must not report read authorization.',
    );
  }
  if (
    value.availability === 'available' &&
    value.status === 'completed' &&
    Array.isArray(value.samples)
  ) {
    return {
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      samples: value.samples,
    };
  }
  if (isUnavailable(value.availability) && value.status === 'notRun') {
    return {
      availability: value.availability,
      status: 'notRun',
      readAuthorization: 'notObservable',
    };
  }
  throw codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit sample query response is invalid.',
  );
}

export function requireMedicationQueryResult(
  value: unknown,
): HealthKitMedicationQueryResult {
  if (!isRecord(value) || value.readAuthorization !== 'notObservable') {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit query must not report read authorization.',
    );
  }
  if (
    value.availability === 'available' &&
    value.status === 'completed' &&
    Array.isArray(value.medications)
  ) {
    return {
      availability: 'available',
      status: 'completed',
      readAuthorization: 'notObservable',
      medications: value.medications,
    };
  }
  if (isUnavailable(value.availability) && value.status === 'notRun') {
    return {
      availability: value.availability,
      status: 'notRun',
      readAuthorization: 'notObservable',
    };
  }
  throw codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit medication query response is invalid.',
  );
}

export function codedError(code: string, message: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}

function isUnavailable(
  value: unknown,
): value is 'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform' {
  return (
    value === 'unavailable' ||
    value === 'unsupportedFeature' ||
    value === 'unsupportedPlatform'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
