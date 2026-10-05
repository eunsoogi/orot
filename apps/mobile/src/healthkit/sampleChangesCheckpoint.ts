import type { HealthKitFeature, HealthKitSampleKind } from './types';
import { validateFeatureSampleKind } from './validation';

/** Keeps a persisted anchor scoped to the feature and sample kind that created it. */
export function healthKitSampleChangesCheckpointKey(
  feature: HealthKitFeature,
  sampleKind: HealthKitSampleKind,
): string {
  const scope = validateFeatureSampleKind(feature, sampleKind);
  return 'healthkit:' + scope.feature + ':' + scope.sampleKind;
}
