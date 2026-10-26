import type { EvidenceBatch } from './contracts';
import { hasIncompleteCoverage } from './evidence';

/** Distinguishes a ranked result page from missing input; conflicts and gaps always remain blocking. */
export function hasBlockingCoverage(
  batch: EvidenceBatch,
  allowBoundedExternalEvidence = false,
  allowRankedLocalEvidence = false,
): boolean {
  if (!allowBoundedExternalEvidence && !allowRankedLocalEvidence)
    return hasIncompleteCoverage(batch);
  return hasIncompleteCoverage({
    ...batch,
    coverage: batch.coverage.map((coverage) =>
      (coverage.sourceKind === 'external_medical' && allowBoundedExternalEvidence) ||
      (coverage.sourceKind !== 'external_medical' &&
        allowRankedLocalEvidence &&
        coverage.selectionMethod === 'ranked_retrieval')
        ? { ...coverage, truncated: false }
        : coverage,
    ),
  });
}
