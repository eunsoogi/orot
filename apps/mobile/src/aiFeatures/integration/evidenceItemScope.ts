import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';

/** Shared pre-selection filter; overview grouping never widens an authorized source or instant range. */
export function scopedEvidenceItems(
  items: readonly EvidenceItem[],
  request: EvidenceSearchRequest,
  sourceKind: EvidenceItem['sourceKind'],
  manualHistoryDate?: (item: EvidenceItem) => string | undefined,
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
    const from = Date.parse(range.fromInclusive);
    const to = Date.parse(range.toExclusive);
    if (!item.effectiveTime) {
      const date = manualHistoryDate?.(item);
      if (!date) return false;
      const start = Date.parse(`${date}T00:00:00.000Z`);
      return start + 24 * 60 * 60 * 1000 > from && start < to;
    }
    const value = Date.parse(item.effectiveTime);
    return (
      Number.isFinite(value) &&
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      value >= from &&
      value < to
    );
  });
}
