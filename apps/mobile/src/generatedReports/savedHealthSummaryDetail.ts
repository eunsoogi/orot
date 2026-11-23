import type { SqlDatabase } from '@orot/storage';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import { restoreSymptomSummary } from '../aiFeatures/integration/symptomSummarySources';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../diseaseHypotheses/summaryPartialEvidence';
import { readableHypothesis } from '../diseaseHypotheses/readableHypothesis';
import { createSymptomSummaryStorage } from '../storage/symptomSummaryStorage';
import { readStandaloneSavedHealthSummary } from '../storage/standaloneSavedHealthSummary';
import { projectGeneratedSummaryDetail } from './summaryDetail';
import { generatedReportCopy as copy } from './text';
import type { GeneratedReportRow } from './types';

/** Source hydration enriches current review notices but is not the authority
 * for an already saved, read-only report. Never turn it into a new source. */
export async function readSavedHealthSummaryDetail(
  database: SqlDatabase,
  row: GeneratedReportRow,
  signal: AbortSignal,
  data: () => Promise<AiFeatureLocalData>,
) {
  if (row.key !== `summary:${row.id}` || signal.aborted) return null;
  await createSymptomSummaryStorage(database).prepareRetentionGuards();
  const original = await readStandaloneSavedHealthSummary(
    database,
    row,
    signal,
  );
  if (!original || signal.aborted) return null;
  let analysis;
  try {
    analysis = await restoreSymptomSummary(
      original.saved,
      new LocalEvidenceReferenceRegistry(),
      await data(),
    );
  } catch (error) {
    if (
      error instanceof RetainedSourceInvalidError &&
      error.reason === 'deleted'
    )
      return null;
    // An unavailable review read must not turn a committed report into a
    // diagnosis, resume anchor, source-action target, or new analysis attempt.
  }
  const current = await readStandaloneSavedHealthSummary(database, row, signal);
  if (signal.aborted || !current || original.serialized !== current.serialized)
    return null;
  if (
    analysis &&
    analysis.savedSummary?.status === 'saved' &&
    !analysis.savedSummary.sourceChanged
  )
    return projectGeneratedSummaryDetail(analysis);
  const paragraphs = current.saved.analysis.hypotheses
    .map(readableHypothesis)
    .flatMap(section => [
      section.title,
      section.summary,
      section.uncertainty,
      ...section.missingData,
    ])
    .filter(Boolean);
  return {
    paragraphs,
    warning: [
      copy.historicalHealthSummary,
      current.saved.analysis.omittedUnsupportedContent
        ? OMITTED_SUMMARY_CONTENT_NOTE
        : undefined,
      current.saved.analysis.incompleteEvidence
        ? INCOMPLETE_SUMMARY_EVIDENCE_NOTE
        : undefined,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}
