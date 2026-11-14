import type { EvidenceReference } from '@orot/agent-runtime';
import type { SavedGeneratedResearchSource } from '../../diseaseHypotheses/savedSummaries';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import type { EvidenceRegistrySnapshot } from './evidenceRegistrySnapshot';
import type { AiFeatureLocalData } from './localData';
import type {
  LocalEvidenceReferenceRegistry,
  EvidenceSourceReadResult,
} from './evidenceRegistry';
import { stableJson } from './evidenceUtils';

/** Cold research readers never allocate aliases or restore dependency sources as a side effect.
 * Bind once after exact import so every returned link belongs to the returned registry. */
export function createColdResearchSourceReader(input: {
  snapshot: EvidenceRegistrySnapshot;
  sources: readonly ConversationArtifactSource[];
  data: AiFeatureLocalData;
}) {
  let registry: LocalEvidenceReferenceRegistry | undefined;
  const snapshot: EvidenceRegistrySnapshot = JSON.parse(
    JSON.stringify(input.snapshot),
  );
  const sources: readonly ConversationArtifactSource[] = JSON.parse(
    JSON.stringify(input.sources),
  );
  const descriptors = new Map(
    sources.map(source => [stableJson(source.reference), source]),
  );
  async function read(
    source: SavedGeneratedResearchSource,
    signal: AbortSignal,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<EvidenceSourceReadResult> {
    const owner = registry;
    const key = stableJson(source.reference);
    // A per-read ancestry path rejects cycles without treating concurrent independent reads as cycles.
    if (
      !owner ||
      signal.aborted ||
      ancestors.has(key) ||
      ancestors.size >= 64 ||
      stableJson(descriptors.get(key)) !== stableJson(source)
    )
      return { status: 'unavailable' };
    const ref = source.reference;
    const locator = ref.locator as { kind?: unknown; type?: unknown } | null;
    if (
      ref.sourceKind !== 'generated_artifact' ||
      source.id !== ref.sourceId ||
      source.id !== ref.evidenceId ||
      source.revision !== ref.sourceRevision ||
      source.revision !== ref.evidenceRevision ||
      locator?.kind !== 'generated_artifact'
    )
      return { status: 'changed' };
    const discovery = await input.data.researchArtifactDiscovery?.();
    if (!discovery || signal.aborted) return { status: 'unavailable' };
    const current = await discovery.read(source.id, signal);
    if (!current) return { status: 'missing' };
    if (
      current.metadata.id !== source.id ||
      current.metadata.revision !== source.revision ||
      current.metadata.type !== locator.type
    )
      return { status: 'changed' };
    const path = new Set([...ancestors, key]);
    const aliases: EvidenceReference[] = [];
    for (const dependency of current.content.inputSources) {
      const dependencyKey = stableJson(dependency.reference);
      const saved = descriptors.get(dependencyKey);
      const matches = snapshot.entries.filter(
        row => stableJson(row.original) === dependencyKey,
      );
      // Never select a first alias from an ambiguous binding, or fetch a missing source to fill a gap.
      if (
        !saved ||
        stableJson(saved) !== stableJson(dependency) ||
        matches.length !== 1 ||
        signal.aborted
      )
        return { status: 'unavailable' };
      const alias = matches[0]!.alias;
      if (stableJson(owner.resolve(alias)) !== dependencyKey)
        return { status: 'changed' };
      const checked =
        'kind' in saved && saved.kind === 'generated_research'
          ? await read(saved, signal, path)
          : await owner.readSource(alias, signal);
      if (checked.status !== 'available') return checked;
      if (
        checked.document.sourceKind === 'generated_artifact' &&
        checked.document.sourceStatus === 'changed'
      )
        return { status: 'changed' };
      aliases.push(alias);
    }
    const latest = await discovery.read(source.id, signal);
    if (signal.aborted) return { status: 'unavailable' };
    if (!latest) return { status: 'missing' };
    if (
      latest.metadata.id !== source.id ||
      latest.metadata.revision !== source.revision ||
      latest.metadata.type !== locator.type ||
      stableJson(latest.content.inputSources) !==
        stableJson(current.content.inputSources)
    )
      return { status: 'changed' };
    return {
      status: 'available',
      document: {
        sourceKind: 'generated_artifact',
        metadata: latest.metadata,
        research: { ...latest.content, inputSources: [] },
        sources: [...latest.sources, ...aliases],
        sourceStatus: 'unknown',
      },
    };
  }
  return {
    bind(value: LocalEvidenceReferenceRegistry) {
      if (registry) throw new Error('Cold research readers already bound.');
      registry = value;
    },
    read,
  };
}
