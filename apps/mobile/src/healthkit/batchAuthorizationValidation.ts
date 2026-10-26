import type {
  HealthKitBatchAuthorizationResult,
  HealthKitFeature,
} from './types';
import { healthKitFeatures } from './types';
import { assertFeature, codedError } from './validation';

/** Rejects empty or repeated batches before they cross the native consent boundary. */
export function validateAuthorizationFeatures(
  value: unknown,
): asserts value is readonly HealthKitFeature[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw codedError(
      'INVALID_REQUEST',
      'At least one HealthKit feature is required for batch authorization.',
    );
  }
  value.forEach(assertFeature);
  if (new Set(value).size !== value.length) {
    throw codedError(
      'INVALID_REQUEST',
      'HealthKit batch authorization cannot repeat a feature.',
    );
  }
}

/** Confirms native results partition only the features selected for this request. */
export function requireBatchAuthorizationResult(
  value: unknown,
  selectedFeatures: readonly HealthKitFeature[],
): HealthKitBatchAuthorizationResult {
  if (!isRecord(value) || value.readAuthorization !== 'notObservable') {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit batch authorization must keep read grants unobservable.',
    );
  }
  const requested = parseFeatureList(value.requestedFeatures);
  const unsupported = parseFeatureList(value.unsupportedFeatures);
  const selected = new Set(selectedFeatures);
  const requestedSet = new Set(requested);
  const unsupportedSet = new Set(unsupported);
  const partitionIsValid =
    requestedSet.size === requested.length &&
    unsupportedSet.size === unsupported.length &&
    requested.every(feature => selected.has(feature)) &&
    unsupported.every(feature => selected.has(feature)) &&
    requested.every(feature => !unsupportedSet.has(feature));

  if (
    value.availability === 'available' &&
    value.requestStatus === 'completed' &&
    requested.length > 0 &&
    partitionIsValid &&
    requested.length + unsupported.length === selected.size
  ) {
    return {
      availability: 'available',
      requestStatus: 'completed',
      readAuthorization: 'notObservable',
      requestedFeatures: requested,
      unsupportedFeatures: unsupported,
    };
  }
  if (
    value.availability === 'unsupportedFeature' &&
    value.requestStatus === 'notRequested' &&
    requested.length === 0 &&
    partitionIsValid &&
    unsupportedSet.size === selected.size
  ) {
    return {
      availability: 'unsupportedFeature',
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
      requestedFeatures: [],
      unsupportedFeatures: unsupported,
    };
  }
  if (
    (value.availability === 'unavailable' ||
      value.availability === 'unsupportedPlatform') &&
    value.requestStatus === 'notRequested' &&
    requested.length === 0 &&
    unsupported.length === 0
  ) {
    return {
      availability: value.availability,
      requestStatus: 'notRequested',
      readAuthorization: 'notObservable',
      requestedFeatures: [],
      unsupportedFeatures: [],
    };
  }
  throw codedError(
    'INVALID_NATIVE_RESPONSE',
    'HealthKit batch authorization response does not match the selection.',
  );
}

function parseFeatureList(value: unknown): HealthKitFeature[] {
  if (!Array.isArray(value)) {
    throw codedError(
      'INVALID_NATIVE_RESPONSE',
      'HealthKit batch authorization feature lists are invalid.',
    );
  }
  value.forEach(feature => {
    if (!healthKitFeatures.includes(feature as HealthKitFeature)) {
      throw codedError(
        'INVALID_NATIVE_RESPONSE',
        'HealthKit batch authorization returned an unknown feature.',
      );
    }
  });
  return value as HealthKitFeature[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
