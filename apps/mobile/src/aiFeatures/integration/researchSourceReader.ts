import type { AiFeatureLocalData } from './localData';
import type {
  LocalEvidenceReferenceRegistry,
  EvidenceSourceReadResult,
} from './evidenceRegistry';
import { restoreRetainedSources } from './restoreRetainedSources';
import { stableJson } from './evidenceUtils';

/** Rebind retained private input links and recheck the research snapshot after the reads. */
export async function readResearchSource(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  id: string,
  revision: string,
  signal: AbortSignal,
): Promise<EvidenceSourceReadResult> {
  const discovery = await data.researchArtifactDiscovery?.();
  if (!discovery || signal.aborted) return { status: 'unavailable' };
  const current = await discovery.read(id, signal);
  if (!current) return { status: 'missing' };
  if (current.metadata.revision !== revision) return { status: 'changed' };
  const restored = await restoreRetainedSources(
    current.content.inputSources,
    registry,
    data,
  );
  if (restored.sourceChanged || signal.aborted) return { status: 'changed' };
  const inputs = current.content.inputSources.map(source =>
    restored.mapping.get(stableJson(source.reference)),
  );
  if (inputs.some(source => !source)) return { status: 'unavailable' };
  const latest = await discovery.read(id, signal);
  if (!latest) return { status: 'missing' };
  if (latest.metadata.revision !== revision) return { status: 'changed' };
  return {
    status: 'available',
    document: {
      sourceKind: 'generated_artifact',
      metadata: latest.metadata,
      research: { ...latest.content, inputSources: [] },
      sources: [
        ...latest.sources,
        ...inputs.filter((source): source is NonNullable<typeof source> =>
          Boolean(source),
        ),
      ],
      sourceStatus: 'unknown',
    },
  };
}
