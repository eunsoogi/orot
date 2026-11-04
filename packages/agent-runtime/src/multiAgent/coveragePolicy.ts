import type { EvidenceBatch } from './contracts';
import { hasIncompleteCoverage } from './evidence';
import type { TaskResponderContract } from './contracts';

/** Distinguishes a ranked result page from missing input; conflicts and gaps always remain blocking. */
export function hasBlockingCoverage(
  batch: EvidenceBatch,
  allowBoundedExternalEvidence = false,
  allowRankedLocalEvidence = false,
  allowPagedGeneratedArtifacts = false,
): boolean {
  if (!allowBoundedExternalEvidence && !allowRankedLocalEvidence && !allowPagedGeneratedArtifacts)
    return hasIncompleteCoverage(batch);
  return hasIncompleteCoverage({
    ...batch,
    coverage: batch.coverage.map((coverage) =>
      (coverage.sourceKind === 'external_medical' && allowBoundedExternalEvidence) ||
      (coverage.sourceKind === 'generated_artifact' &&
        allowPagedGeneratedArtifacts &&
        coverage.selectionMethod === 'paged_retrieval') ||
      (coverage.sourceKind !== 'external_medical' &&
        allowRankedLocalEvidence &&
        coverage.selectionMethod === 'ranked_retrieval')
        ? { ...coverage, truncated: false }
        : coverage,
    ),
  });
}

/** Empty evidence and unstructured conflicts cannot support an opt-in partial result. */
export function canContinueWithPartialEvidence<TResult>(
  task: TaskResponderContract<TResult>,
  batch: EvidenceBatch,
): boolean {
  if (
    task.allowPartialEvidence !== true ||
    !batch.items.length ||
    !batch.coverage.length ||
    batch.conflicts.length
  )
    return false;
  return true;
}
