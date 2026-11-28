import type {
  CommonObservationRepository,
  SyncCommonObservationChangesOptions,
} from './syncOptions';
import type { CommonObservationFeature } from './types';

const pendingSyncs = new WeakMap<
  CommonObservationRepository,
  Map<CommonObservationFeature, Promise<void>>
>();

/** Keep the queue per repository and feature; other record types never wait on it. */
export function serializeFeatureSync<T>(
  options: SyncCommonObservationChangesOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lockIdentity = options.repository;
  let featureTails = pendingSyncs.get(lockIdentity);
  if (!featureTails) {
    featureTails = new Map();
    pendingSyncs.set(lockIdentity, featureTails);
  }

  const previous = featureTails.get(options.feature) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  featureTails.set(options.feature, tail);

  return previous.then(operation).finally(() => {
    release();
    if (featureTails?.get(options.feature) === tail) {
      featureTails.delete(options.feature);
      if (featureTails.size === 0) pendingSyncs.delete(lockIdentity);
    }
  });
}
