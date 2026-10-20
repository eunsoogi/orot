import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';

/** Shared pre-selection filter; overview grouping never widens an authorized source or instant range. */
export function scopedEvidenceItems(
  items: readonly EvidenceItem[],
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
) {
  return items.filter(item => {
    if (
      item.sourceKind !== sourceKind ||
      (request.allowedScope.sourceIds &&
        !request.allowedScope.sourceIds.includes(item.sourceId))
    )
      return false;
    const range = request.allowedScope.timeRange;
    if (!range) return true;
    if (!item.effectiveTime) return false;
    const value = Date.parse(item.effectiveTime);
    const from = Date.parse(range.fromInclusive);
    const to = Date.parse(range.toExclusive);
    return (
      Number.isFinite(value) &&
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      value >= from &&
      value < to
    );
  });
}
