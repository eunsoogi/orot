import type { ArtifactMetadata } from '../../healthEvidence/artifactDiscovery';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';

/** Bound provider text while keeping full retained content behind a revalidated citation. */
export function artifactExcerpt(
  metadata: ArtifactMetadata,
  analysis: DiseaseHypothesisAnalysis,
  sourceStatus: 'current' | 'changed' | 'unknown',
) {
  const truncated = analysis.hypotheses.some(
    section =>
      section.title.length > 100 ||
      section.summary.length > 700 ||
      section.uncertainty.length > 300 ||
      section.missingData.length > 3 ||
      section.missingData.some(text => text.length > 100),
  );
  const sections = analysis.hypotheses.map(section => ({
    title: section.title.slice(0, 100),
    summary: section.summary.slice(0, 700),
    uncertainty: section.uncertainty.slice(0, 300),
    missingData: section.missingData
      .slice(0, 3)
      .map(text => text.slice(0, 100)),
    supportingSources: section.supportingEvidence.map(reference => ({
      kind: reference.sourceKind,
      evidenceId: reference.evidenceId,
      ...(reference.sourceKind === 'external_medical'
        ? { locator: reference.locator }
        : {}),
    })),
    contrarySources: section.contraryEvidence.map(reference => ({
      kind: reference.sourceKind,
      evidenceId: reference.evidenceId,
      ...(reference.sourceKind === 'external_medical'
        ? { locator: reference.locator }
        : {}),
    })),
  }));
  return {
    full: JSON.stringify({
      kind: metadata.type,
      createdAt: metadata.createdAt,
      provider: metadata.providerId,
      model: metadata.modelId,
      sourceStatus,
      excerptTruncated: truncated,
      warning:
        'Historical AI-generated interpretation, not independently verified medical evidence.',
      sections,
    }),
    compact: JSON.stringify({
      kind: metadata.type,
      createdAt: metadata.createdAt.slice(0, 50),
      provider: metadata.providerId?.slice(0, 64),
      model: metadata.modelId?.slice(0, 64),
      sourceStatus,
      excerptTruncated: true,
      warning:
        'Historical AI-generated interpretation; open its citation for the retained result and sources.',
    }),
  };
}
