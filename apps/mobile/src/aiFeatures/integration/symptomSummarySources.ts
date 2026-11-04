import type { EvidenceReference } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type { SavedSymptomSummary } from '../../diseaseHypotheses/savedSummaries';
import { hasCompleteSummaryLineage } from '../../diseaseHypotheses/savedSummaries';
import type { AiFeatureLocalData } from './localData';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  summaryReferences as references,
  remapSavedAnalysis as mapAnalysis,
} from './savedAnalysis';
import { summaryContentReviewIssues } from './summaryContentReview';
import { captureEvidenceSources } from './captureEvidenceSources';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';

/** Persist storage identities, never turn-local e1/s1 aliases that can refer to different rows after restart. */
export async function captureSymptomSummarySources(
  analysis: DiseaseHypothesisAnalysis,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
  admittedReferences: readonly EvidenceReference[] = references(analysis),
) {
  // Uncited inputs can influence prose and must share the same deletion boundary.
  const { mapping, sources } = await captureEvidenceSources(
    [...references(analysis), ...admittedReferences],
    registry,
    signal,
  );
  return {
    analysis: mapAnalysis(analysis, ref => mapping.get(JSON.stringify(ref))!),
    sources,
  };
}

/** Restores exact source reads; changed or deleted records never silently become a historical citation. */
export async function restoreSymptomSummary(
  saved: SavedSymptomSummary,
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
): Promise<DiseaseHypothesisAnalysis> {
  // Never expose prose whose uncited inputs cannot be checked against deletion.
  if (!hasCompleteSummaryLineage(saved))
    throw new Error('The saved summary input lineage is unavailable.');
  const { mapping, sourceChanged, reviewEvidence } =
    await restoreRetainedSources(saved.sources, registry, data);
  const contentReviewIssues = summaryContentReviewIssues(
    saved.analysis,
    reviewEvidence,
  );
  return {
    ...mapAnalysis(saved.analysis, ref => mapping.get(stableJson(ref))!),
    savedSummary: {
      status: 'saved',
      id: saved.id,
      createdAt: saved.createdAt,
      modelName: saved.modelName,
      sourceChanged,
      ...(contentReviewIssues.length ? { contentReviewIssues } : {}),
    },
  };
}
