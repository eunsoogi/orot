import type {
  AllowedEvidenceScope,
  EvidenceBatch,
  EvidenceReference,
  MultiAgentBudget,
} from './contracts';

// Evidence stays in private invocation memory; checkpoints receive only these references.
export function referencesFromBatch(batch: EvidenceBatch): EvidenceReference[] {
  return batch.items.map(({ content: _content, ...reference }) => reference);
}

export function referenceKey(reference: EvidenceReference): string {
  return [
    reference.sourceKind,
    reference.sourceId,
    reference.sourceRevision,
    reference.evidenceId,
    reference.evidenceRevision,
  ].join('\u0000');
}

export function sameReference(left: EvidenceReference, right: EvidenceReference): boolean {
  return (
    referenceKey(left) === referenceKey(right) &&
    left.effectiveTime === right.effectiveTime &&
    left.unit === right.unit &&
    left.reviewState === right.reviewState &&
    JSON.stringify(left.locator) === JSON.stringify(right.locator)
  );
}

export function isSourceAllowed(
  scope: AllowedEvidenceScope,
  sourceKind: string,
  sourceId?: string,
) {
  return (
    scope.sourceKinds.includes(sourceKind as AllowedEvidenceScope['sourceKinds'][number]) &&
    (sourceId === undefined || scope.sourceIds === undefined || scope.sourceIds.includes(sourceId))
  );
}

function parseTime(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimeRange(start: string, end: string): boolean {
  const from = parseTime(start);
  const through = parseTime(end);
  return from !== null && through !== null && from <= through;
}

function isWithinRange(value: string | null, scope: AllowedEvidenceScope): boolean {
  if (!scope.timeRange) return true;
  const instant = parseTime(value ?? undefined);
  const start = parseTime(scope.timeRange.start);
  const end = parseTime(scope.timeRange.end);
  return instant !== null && start !== null && end !== null && instant >= start && instant <= end;
}

export function validateEvidenceBatch(
  batch: EvidenceBatch,
  scope: AllowedEvidenceScope,
  budget: MultiAgentBudget,
): string | undefined {
  // Reject broadened provenance, time bounds, duplicate revisions, and inaccurate coverage together.
  if (batch.items.length > budget.maxEvidenceItems) return 'The evidence item limit was exceeded.';
  const seen = new Set<string>();
  for (const item of batch.items) {
    if (
      !item.sourceId ||
      !item.sourceRevision ||
      !item.evidenceId ||
      !item.evidenceRevision ||
      !item.content.trim() ||
      !isSourceAllowed(scope, item.sourceKind, item.sourceId) ||
      !isWithinRange(item.effectiveTime, scope)
    ) {
      return 'Evidence did not match the allowed source or time scope.';
    }
    if (scope.timeRange && item.effectiveTime === null) {
      return 'Evidence without an effective time cannot satisfy a bounded time scope.';
    }
    if (seen.has(referenceKey(item))) return 'Evidence contained a duplicate reference.';
    seen.add(referenceKey(item));
  }
  if (batch.conflicts.some((conflict) => !conflict.trim())) {
    return 'Evidence conflict metadata was malformed.';
  }
  for (const coverage of batch.coverage) {
    if (
      !isSourceAllowed(scope, coverage.sourceKind) ||
      !Number.isInteger(coverage.resultLimit) ||
      coverage.resultLimit < 1 ||
      coverage.resultLimit > budget.maxEvidenceItems ||
      !Number.isInteger(coverage.returnedCount) ||
      coverage.returnedCount < 0 ||
      coverage.returnedCount > coverage.resultLimit ||
      coverage.returnedCount !==
        batch.items.filter((item) => item.sourceKind === coverage.sourceKind).length ||
      coverage.searchedSourceIds.some(
        (sourceId) => !isSourceAllowed(scope, coverage.sourceKind, sourceId),
      ) ||
      coverage.gaps.some((gap) => !gap.trim())
    ) {
      return 'Evidence coverage metadata was invalid or outside the allowed scope.';
    }
    if (
      coverage.requestedTimeRange &&
      !validTimeRange(coverage.requestedTimeRange.start, coverage.requestedTimeRange.end)
    ) {
      return 'Evidence coverage contained an invalid requested time range.';
    }
    if (
      scope.timeRange &&
      JSON.stringify(coverage.requestedTimeRange) !== JSON.stringify(scope.timeRange)
    ) {
      return 'Evidence coverage did not preserve the requested time range.';
    }
    if (coverage.coveredTimeRange) {
      if (!validTimeRange(coverage.coveredTimeRange.start, coverage.coveredTimeRange.end)) {
        return 'Evidence coverage contained an invalid covered time range.';
      }
      if (
        scope.timeRange &&
        (Date.parse(coverage.coveredTimeRange.start) < Date.parse(scope.timeRange.start) ||
          Date.parse(coverage.coveredTimeRange.end) > Date.parse(scope.timeRange.end))
      ) {
        return 'Evidence coverage extended beyond the requested time range.';
      }
    }
  }
  return undefined;
}

export function hasIncompleteCoverage(batch: EvidenceBatch): boolean {
  return (
    batch.items.length === 0 ||
    batch.conflicts.length > 0 ||
    batch.coverage.length === 0 ||
    batch.coverage.some((coverage) => coverage.truncated || coverage.gaps.length > 0)
  );
}
