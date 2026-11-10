import type { EvidenceBatch, EvidenceItem } from '@orot/agent-runtime';

/** Reserve the selected visit within the existing evidence budget and keep coverage accurate. */
export function includeConversationTarget(
  batch: EvidenceBatch,
  target: EvidenceItem | undefined,
  limit: number,
): EvidenceBatch {
  if (!target) return batch;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError('The evidence budget must admit the selected visit.');
  // Citation IDs must remain unambiguous across local and public evidence.
  if (batch.items.some(item => item.evidenceId === target.evidenceId))
    throw new Error('The selected visit evidence identifier is ambiguous.');
  const retained = batch.items;
  const items = [target, ...retained].slice(0, limit);
  const coverage = batch.coverage.map(entry => {
    const count = items.filter(
      item => item.sourceKind === entry.sourceKind,
    ).length;
    const available =
      retained.filter(item => item.sourceKind === entry.sourceKind).length +
      (entry.sourceKind === target.sourceKind ? 1 : 0);
    return {
      ...entry,
      returnedCount: count,
      resultLimit: Math.max(entry.resultLimit, count),
      truncated: entry.truncated || count < available,
      searchedSourceIds:
        entry.sourceKind === target.sourceKind
          ? [...new Set([...entry.searchedSourceIds, target.sourceId])]
          : entry.searchedSourceIds,
    };
  });
  if (!coverage.some(entry => entry.sourceKind === target.sourceKind)) {
    coverage.push({
      sourceKind: target.sourceKind,
      searchedSourceIds: [target.sourceId],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    });
  }
  return { ...batch, items, coverage };
}

/** Keep every selected report source within the existing shared evidence budget. */
export function includeDailyReportEvidence(
  batch: EvidenceBatch,
  items: readonly EvidenceItem[],
  limit: number,
): EvidenceBatch {
  return [...items]
    .reverse()
    .reduce(
      (current, item) => includeConversationTarget(current, item, limit),
      batch,
    );
}

/** Reserve explicit targets together; never silently drop one to fit the budget. */
export function includeConversationTargets(
  batch: EvidenceBatch,
  visit: EvidenceItem | undefined,
  report: readonly EvidenceItem[],
  limit: number,
): EvidenceBatch {
  if (report.length + Number(Boolean(visit)) > limit)
    throw new RangeError('Selected evidence exceeds the evidence budget.');
  return includeDailyReportEvidence(
    includeConversationTarget(batch, visit, limit),
    report,
    limit,
  );
}
