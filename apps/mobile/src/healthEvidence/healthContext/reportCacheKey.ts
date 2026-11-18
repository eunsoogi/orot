import { stableJson } from '../../aiFeatures/integration/evidenceUtils';
import type { HealthContextTopic, HealthContextWindow } from './types';

/** JSON field order is not a different query. Preserve every window field/value
 * (including cutoff and dose selection) while sharing only identical topic sets.
 * This key is not source validity: generation, deletion and ownership fences remain. */
export function healthContextReportCacheKey(
  window: HealthContextWindow,
  topics: readonly HealthContextTopic[],
): string {
  return stableJson([window, [...new Set(topics)].sort()]);
}
