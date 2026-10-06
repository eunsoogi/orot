import type {
  HealthKitBatchAuthorizationResult,
  HealthKitFeature,
  HealthKitNativeModule,
} from './types';
import { healthKitFeatures } from './types';
import { validateAuthorizationFeatures } from './batchAuthorizationValidation';
import { codedError } from './validation';

type BatchAuthorizationClient = Pick<
  HealthKitNativeModule,
  'requestReadAuthorizations'
>;

const pendingRequests = new WeakMap<
  BatchAuthorizationClient,
  Map<string, Promise<HealthKitBatchAuthorizationResult>>
>();

/** Coalesces overlapping consent calls so re-entry cannot stack system prompts. */
export function requestHealthKitBatchAuthorization(options: {
  readonly features: readonly HealthKitFeature[];
  readonly healthKit: BatchAuthorizationClient;
}): Promise<HealthKitBatchAuthorizationResult> {
  let selected: HealthKitFeature[];
  try {
    validateAuthorizationFeatures(options.features);
    selected = normalizeFeatures(options.features);
  } catch (error) {
    return Promise.reject(error);
  }
  const key = selected.join(',');
  let requests = pendingRequests.get(options.healthKit);
  if (!requests) {
    requests = new Map();
    pendingRequests.set(options.healthKit, requests);
  }

  const pending = requests.get(key);
  if (pending) return pending;

  // Defer the native call one microtask so identical callers can share its promise.
  const request = Promise.resolve().then(() =>
    options.healthKit.requestReadAuthorizations(selected),
  );
  requests.set(key, request);
  const release = () => {
    if (requests?.get(key) !== request) return;
    requests.delete(key);
    if (requests.size === 0) pendingRequests.delete(options.healthKit);
  };
  request.then(release, release);
  return request;
}

function normalizeFeatures(
  features: readonly HealthKitFeature[],
): HealthKitFeature[] {
  const selected = new Set(features);
  const normalized = healthKitFeatures.filter(feature => selected.has(feature));
  if (normalized.length !== selected.size) {
    throw codedError(
      'INVALID_REQUEST',
      'HealthKit batch authorization selection is invalid.',
    );
  }
  return normalized;
}
