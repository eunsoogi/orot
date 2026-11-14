import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import type { AiFeatureLocalData } from './localData';
import { stableJson } from './evidenceUtils';

/** Inspect the research-only dependency DAG before sharing pending alias work.
 * A cycle must fail before it can wait on its own pending restoration. Mixed generated catalogs keep
 * their existing uncached path until they have an equivalent cross-catalog ownership contract. */
export async function reusableResearchInputGraph(
  sources: readonly SavedSummarySource[],
  data: AiFeatureLocalData,
  signal: AbortSignal,
  ancestors: ReadonlySet<string> = new Set(),
  budget = { remaining: 256 },
): Promise<boolean> {
  if (signal.aborted || ancestors.size >= 64 || --budget.remaining < 0)
    throw new Error('Research dependency graph unavailable.');
  let supported = true;
  for (const source of sources) {
    if (source.reference.sourceKind === 'external_medical') {
      supported = false;
      continue;
    }
    if (!('kind' in source) || !source.kind.startsWith('generated_')) continue;
    if (source.kind !== 'generated_research') {
      supported = false;
      continue;
    }
    const key = stableJson(source.reference);
    if (ancestors.has(key)) throw new Error('Cyclic research dependency.');
    const discovery = await data.researchArtifactDiscovery?.();
    const value = await discovery?.read(source.id, signal);
    if (
      !value ||
      signal.aborted ||
      value.metadata.id !== source.id ||
      value.metadata.revision !== source.revision ||
      value.metadata.type !==
        (source.reference.locator as { type?: unknown } | null)?.type
    )
      throw new Error('Research dependency changed.');
    const nested = await reusableResearchInputGraph(
      value.content.inputSources,
      data,
      signal,
      new Set([...ancestors, key]),
      budget,
    );
    supported = supported && nested;
  }
  return supported;
}
