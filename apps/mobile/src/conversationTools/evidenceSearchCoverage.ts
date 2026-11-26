import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceSearchRequest,
} from '@orot/agent-runtime';

/** Coverage describes returned provider projections without claiming exhaustive raw retrieval. */
export function resultCoverage(
  coverage: EvidenceBatch['coverage'],
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
  items: readonly EvidenceItem[],
  truncated: boolean,
  failure?: string,
) {
  const base = coverage.find(value => value.sourceKind === sourceKind);
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
