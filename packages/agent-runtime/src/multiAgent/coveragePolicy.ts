import type { EvidenceBatch } from './contracts';
import { hasIncompleteCoverage } from './evidence';

/** A bounded literature answer can cite a result page, but cannot hide missing abstracts or local gaps. */
export function hasBlockingCoverage(
  batch: EvidenceBatch,
  allowBoundedExternalEvidence = false,
): boolean {
  if (!allowBoundedExternalEvidence) return hasIncompleteCoverage(batch);
  return hasIncompleteCoverage({
    ...batch,
    coverage: batch.coverage.map((coverage) =>
      coverage.sourceKind === 'external_medical' ? { ...coverage, truncated: false } : coverage,
    ),
  });
}
