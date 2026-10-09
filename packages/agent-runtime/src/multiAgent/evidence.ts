import type {
  AllowedEvidenceScope,
  EvidenceBatch,
  EvidenceReference,
  MultiAgentBudget,
} from './contracts';
import { comparePreciseTimestamps, isOrderedTimestampRange } from './timestamps';

// Evidence stays in private invocation memory; checkpoints receive only these references.
export function referencesFromBatch(batch: EvidenceBatch): EvidenceReference[] {
  return batch.items.map(projectEvidenceReference);
}

// Structural types keep extra record payloads; project the explicitly public citation fields.
export function projectEvidenceReference(item: EvidenceReference): EvidenceReference {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
    locator: item.locator,
    effectiveTime: item.effectiveTime,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    reviewState: item.reviewState,
  };
}

export function isEvidenceReference(value: unknown): value is EvidenceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reference = value as Partial<EvidenceReference>;
  return (
    ['personal_record', 'reviewed_memory', 'external_medical'].includes(
      reference.sourceKind ?? '',
    ) &&
    typeof reference.sourceId === 'string' &&
    typeof reference.sourceRevision === 'string' &&
    typeof reference.evidenceId === 'string' &&
    typeof reference.evidenceRevision === 'string' &&
    'locator' in reference &&
    (reference.effectiveTime === null || typeof reference.effectiveTime === 'string') &&
    (reference.unit === undefined || typeof reference.unit === 'string') &&
    ['reviewed', 'unreviewed', 'unknown'].includes(reference.reviewState ?? '')
  );
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

function validTimeRange(fromInclusive: string, toExclusive: string): boolean {
  return isOrderedTimestampRange(fromInclusive, toExclusive);
}

function isWithinRange(value: string | null, scope: AllowedEvidenceScope): boolean {
  if (!scope.timeRange) return true;
  if (value === null) return false;
  const from = comparePreciseTimestamps(value, scope.timeRange.fromInclusive);
  const to = comparePreciseTimestamps(value, scope.timeRange.toExclusive);
  return from !== undefined && to !== undefined && from >= 0 && to < 0;
}

// Check saved references before callbacks can read or validate sources outside the run's scope.
export function isEvidenceReferenceWithinScope(
  reference: EvidenceReference,
  scope: AllowedEvidenceScope,
): boolean {
  return (
    isSourceAllowed(scope, reference.sourceKind, reference.sourceId) &&
    isWithinRange(reference.effectiveTime, scope)
  );
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
      !validTimeRange(
        coverage.requestedTimeRange.fromInclusive,
        coverage.requestedTimeRange.toExclusive,
      )
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
      if (
        !validTimeRange(
          coverage.coveredTimeRange.fromInclusive,
          coverage.coveredTimeRange.toExclusive,
        )
      ) {
        return 'Evidence coverage contained an invalid covered time range.';
      }
      if (scope.timeRange) {
        const coveredStart = comparePreciseTimestamps(
          coverage.coveredTimeRange.fromInclusive,
          scope.timeRange.fromInclusive,
        );
        const coveredEnd = comparePreciseTimestamps(
          coverage.coveredTimeRange.toExclusive,
          scope.timeRange.toExclusive,
        );
        if (
          coveredStart === undefined ||
          coveredEnd === undefined ||
          coveredStart < 0 ||
          coveredEnd > 0
        ) {
          return 'Evidence coverage extended beyond the requested time range.';
        }
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
