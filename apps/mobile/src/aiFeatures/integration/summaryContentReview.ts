import type { EvidenceItem } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import { summaryFactIssue } from '../../diseaseHypotheses/summaryFactValidation';

/** Preserve targeted review warnings when a saved result is restored against current evidence. */
export function summaryContentReviewIssues(
  analysis: DiseaseHypothesisAnalysis,
  evidence: readonly EvidenceItem[],
) {
  return [
    ...new Set(
      analysis.hypotheses.flatMap(section => {
        const issue = summaryFactIssue({ hypotheses: [section] }, evidence);
        return issue === 'prescription' ||
          issue === 'sleep_count' ||
          issue === 'sleep_duration' ||
          issue === 'step_unit'
          ? [issue]
          : [];
      }),
    ),
  ];
}
