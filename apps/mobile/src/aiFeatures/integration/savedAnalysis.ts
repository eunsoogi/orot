import type { EvidenceReference } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';

/** Shared sources are captured once even when several possibilities cite them. */
export function summaryReferences(analysis: DiseaseHypothesisAnalysis) {
  return [
    ...new Map(
      analysis.hypotheses
        .flatMap(item => [...item.supportingEvidence, ...item.contraryEvidence])
        .map(ref => [JSON.stringify(ref), ref]),
    ).values(),
  ];
}
/** Rebind durable source identities without carrying transient save-status UI state. */
export function remapSavedAnalysis(
  analysis: DiseaseHypothesisAnalysis,
  map: (ref: EvidenceReference) => EvidenceReference,
): DiseaseHypothesisAnalysis {
  return {
    // An absent presentation denotes possibility exploration, including its
    // contrary evidence and uncertainty; retain that mode across source remapping.
    ...(analysis.presentation ? { presentation: analysis.presentation } : {}),
    hypotheses: analysis.hypotheses.map(item => ({
      ...item,
      supportingEvidence: item.supportingEvidence.map(map),
      contraryEvidence: item.contraryEvidence.map(map),
    })),
  };
}
