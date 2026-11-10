import type { DailyReportIdentity } from '@orot/domain';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createDailyReportFeature } from './dailyReportFeature';
import { stableJson } from './evidenceUtils';

/** Revalidate the exact saved revision and its source lineage before exposing source links. */
export function createDailyReportSourceResolver(input: {
  data: () => Promise<AiFeatureLocalData>;
  registry: LocalEvidenceReferenceRegistry;
  report: ReturnType<typeof createDailyReportFeature>;
}) {
  return async (
    identity: DailyReportIdentity,
    runId: string,
    revision: number,
    signal: AbortSignal,
  ) => {
    const state = async () => {
      const saved = await input.report.lookup(identity);
      if (saved.status === 'error') return 'unavailable' as const;
      return saved.status === 'saved' &&
        saved.runId === runId &&
        saved.revision === revision
        ? ('current' as const)
        : ('stale' as const);
    };
    if (signal.aborted) return { status: 'unavailable' as const };
    const before = await state();
    if (before !== 'current') return { status: before };
    const data = await input.data();
    const discovery = await data.summaryArtifactDiscovery?.(input.registry);
    const detail = await discovery?.read(runId, signal);
    const after = await state();
    if (after !== 'current') return { status: after };
    if (
      !detail ||
      detail.metadata.type !== 'daily_report' ||
      detail.sourceStatus !== 'current' ||
      signal.aborted
    )
      return { status: 'unavailable' as const };
    // Only cited report evidence is offered; other retained lineage is not a claim.
    const cited = detail.content.hypotheses.flatMap(
      item => item.supportingEvidence,
    );
    const available = new Map(
      detail.sources.map(source => [stableJson(source), source]),
    );
    const links = cited.map(source => available.get(stableJson(source)));
    if (links.some(source => !source))
      return { status: 'unavailable' as const };
    return {
      status: 'current' as const,
      sources: [
        ...new Map(links.map(source => [stableJson(source), source!])).values(),
      ],
    };
  };
}
