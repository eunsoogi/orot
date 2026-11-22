import { readableHypothesis } from '../diseaseHypotheses/readableHypothesis';
import type { DiseaseHypothesisAnalysis } from '../diseaseHypotheses/types';
import { generatedReportCopy as copy } from './text';
import type { GeneratedReportDetail } from './types';

/** The report and its bookmark display use the same non-diagnostic, read-only presentation. */
export function projectGeneratedSummaryDetail(
  analysis: DiseaseHypothesisAnalysis,
): GeneratedReportDetail {
  return {
    analysis,
    paragraphs: analysis.hypotheses
      .map(readableHypothesis)
      .flatMap(h => [h.title, h.summary, h.uncertainty, ...h.missingData]),
    warning:
      analysis.savedSummary?.status === 'saved' &&
      analysis.savedSummary.sourceChanged
        ? copy.changed
        : copy.coverage,
  };
}
