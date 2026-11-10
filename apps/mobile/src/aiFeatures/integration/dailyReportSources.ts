import type { DailyReportIdentity } from '@orot/domain';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createDailyReportFeature } from './dailyReportFeature';
import { stableJson } from './evidenceUtils';

type Feature = ReturnType<typeof createDailyReportFeature>;
type Lookup = Awaited<ReturnType<Feature['lookup']>>;
type DailyReportSourceStatus = 'current' | 'stale' | 'deleted' | 'unavailable';

function lookupStatus(
  lookup: Lookup,
  target: { readonly runId: string; readonly revision: number },
): DailyReportSourceStatus {
  if (lookup.status === 'saved')
    return lookup.runId === target.runId && lookup.revision === target.revision
      ? 'current'
      : 'stale';
  if (lookup.status === 'error') return 'unavailable';
  if (lookup.status === 'deleted' || lookup.status === 'missing')
    return 'deleted';
  if (lookup.status === 'stale')
    return lookup.sourceStatus === 'deleted' ? 'deleted' : 'stale';
  return 'unavailable';
}

/** Reopen source links only while the exact saved report revision remains active. */
export function createDailyReportSourceResolver(input: {
  data: () => Promise<AiFeatureLocalData>;
  registry: LocalEvidenceReferenceRegistry;
  report: Feature;
}) {
  return async (
    identity: DailyReportIdentity,
    runId: string,
    revision: number,
    signal: AbortSignal,
  ) => {
    const target = { identity, runId, revision };
    const before = await input.report.lookup(identity);
    const beforeStatus = lookupStatus(before, target);
    if (signal.aborted) return { status: 'unavailable' as const };
    if (beforeStatus !== 'current') return { status: beforeStatus };

    const data = await input.data();
    const discovery = await data.summaryArtifactDiscovery?.(input.registry);
    const detail = await discovery?.read(runId, signal);
    const after = await input.report.lookup(identity);
    const afterStatus = lookupStatus(after, target);
    if (signal.aborted) return { status: 'unavailable' as const };
    if (afterStatus !== 'current') return { status: afterStatus };
    if (!detail || detail.metadata.type !== 'daily_report')
      return { status: 'unavailable' as const };
    if (detail.sourceStatus === 'changed') return { status: 'stale' as const };
    if (detail.sourceStatus !== 'current')
      return { status: 'unavailable' as const };

    // Only citations attached to report claims are available as original sources.
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
