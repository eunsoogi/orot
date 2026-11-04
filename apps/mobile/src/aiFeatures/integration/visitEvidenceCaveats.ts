import type { EvidenceBatch } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceCollection } from '../../agent/visitQuestions/evidenceCollection';
import type { EvidenceCaveat } from '../../nextVisitQuestions/types';

export type EvidenceCoverageState = Pick<
  VisitQuestionEvidenceCollection,
  'memoryStatus'
> & {
  readonly batch: Pick<EvidenceBatch, 'coverage' | 'conflicts'>;
};

/** Preserve search gaps without exposing source content. */
export function currentEvidenceCaveats(
  collections: readonly EvidenceCoverageState[],
): EvidenceCaveat[] {
  const caveats = new Set<EvidenceCaveat>();
  if (
    collections.some(collection =>
      collection.batch.coverage.some(item => item.gaps.length > 0),
    )
  )
    caveats.add('incomplete_coverage');
  if (
    collections.some(collection =>
      collection.batch.coverage.some(item => item.truncated),
    )
  )
    caveats.add('truncated_results');
  if (collections.some(collection => collection.batch.conflicts.length > 0))
    caveats.add('conflicting_records');
  if (
    collections.some(
      collection => collection.memoryStatus === 'local_memory_unavailable',
    )
  )
    caveats.add('reviewed_memory_unavailable');
  else if (
    collections.length > 0 &&
    collections.every(
      collection => collection.memoryStatus === 'no_matching_current_memory',
    )
  ) {
    caveats.add('no_matching_reviewed_memory');
  }
  return [...caveats];
}
