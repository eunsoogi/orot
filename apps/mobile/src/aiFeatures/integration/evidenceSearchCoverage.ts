import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';

/** Coverage describes returned provider projections without claiming exhaustive raw retrieval. */
export function resultCoverage(
  snapshot: LocalEvidenceSnapshot,
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
  items: readonly EvidenceItem[],
  truncated: boolean,
  failure?: string,
) {
  const base = snapshot.coverage.find(value => value.sourceKind === sourceKind);
  return {
    sourceKind,
    // Only the application snapshot can attest that ranked selection covered a complete local inventory.
    ...(base?.selectionMethod ? { selectionMethod: base.selectionMethod } : {}),
    searchedSourceIds: [...new Set(items.map(item => item.sourceId))],
    ...(request.allowedScope.timeRange
      ? { requestedTimeRange: request.allowedScope.timeRange }
      : {}),
    gaps: [...(base?.gaps ?? []), ...(failure ? [failure] : [])],
    truncated: Boolean(base?.truncated || truncated),
    resultLimit: request.resultLimit,
    returnedCount: items.length,
  };
}
