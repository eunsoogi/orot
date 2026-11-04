import type { DiseaseHypothesisAnalysis } from './types';

/** Generated interpretations and public literature cannot be presented as record facts. */
export function hasMixedSummarySources(
  analysis: DiseaseHypothesisAnalysis,
): boolean {
  return analysis.hypotheses.some(section => {
    const kinds = new Set(
      section.supportingEvidence.map(reference => reference.sourceKind),
    );
    return (
      kinds.size > 1 &&
      (kinds.has('external_medical') || kinds.has('generated_artifact'))
    );
  });
}
