import type { SymptomSummaryStorage } from '../../diseaseHypotheses/savedSummaries';
import {
  hasCompleteSummaryLineage,
  isPeriodSummarySource,
} from '../../diseaseHypotheses/savedSummaries';
import type {
  HealthSummaryReference,
  HealthSummaryResult,
} from '../../ragConversation/healthSummary';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreSymptomSummary } from './symptomSummarySources';
import { fingerprint, stableJson } from './evidenceUtils';

/** Restore only a real summary whose admitted period sources agree with the stored reference. */
export async function restoreHealthSummary(input: {
  reference: HealthSummaryReference;
  storage: SymptomSummaryStorage;
  registry: LocalEvidenceReferenceRegistry;
  data: AiFeatureLocalData;
}): Promise<HealthSummaryResult | null> {
  const saved = await input.storage.read(input.reference.summaryId);
  if (
    !saved ||
    !hasCompleteSummaryLineage(saved) ||
    saved.analysis.presentation !== 'symptom_summary'
  )
    return null;
  const periods = saved.sources.filter(isPeriodSummarySource);
  if (
    !periods.length ||
    periods.some(
      source =>
        stableJson(source.scope.window) !== stableJson(input.reference.window),
    )
  )
    return null;
  const analysis = await restoreSymptomSummary(
    saved,
    input.registry,
    input.data,
  );
  const latest = await input.storage.readWithStatus(saved.id);
  if (!latest || fingerprint(latest.summary) !== fingerprint(saved))
    return null;
  return {
    reference: input.reference,
    analysis:
      latest.sourceChanged && analysis.savedSummary?.status === 'saved'
        ? {
            ...analysis,
            savedSummary: { ...analysis.savedSummary, sourceChanged: true },
          }
        : analysis,
  };
}
