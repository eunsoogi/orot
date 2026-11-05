import type {
  EvidenceReference,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { captureEvidenceSources } from './captureEvidenceSources';
import { stableJson } from './evidenceUtils';
import type { AiFeatureLocalData } from './localData';
import { readResearchSource } from './researchSourceReader';

/** Keep every local tool result that could have influenced a later free-form research query. */
export function createResearchInputTracker(
  registry: LocalEvidenceReferenceRegistry,
  data?: AiFeatureLocalData,
) {
  const inputs = new Map<string, EvidenceReference>();
  const retained = new Map<string, EvidenceReference>();
  let incomplete = false;
  return {
    async recordResearch(
      ids: readonly number[],
      signal: AbortSignal,
      toolReferences?: readonly import('@orot/agent-runtime').ToolSourceReference[],
    ) {
      if (!ids.length) return;
      const discovery = await data?.researchArtifactDiscovery?.();
      if (!discovery || !data || signal.aborted) {
        incomplete = true;
        return;
      }
      for (const [index, id] of ids.entries()) {
        const detail = await discovery.read(`research-${id}`, signal);
        if (!detail) {
          incomplete = true;
          continue;
        }
        const meta = detail.metadata;
        const key = stableJson([meta.id, meta.revision]);
        const existing = retained.get(key);
        if (existing) {
          const toolReference = toolReferences?.[index];
          if (toolReference) registry.bindToolResearch(toolReference, existing);
          continue;
        }
        const readSource = (current: AbortSignal) =>
          readResearchSource(data, registry, meta.id, meta.revision, current);
        const alias = registry.add({
          reference: {
            sourceKind: 'generated_artifact',
            sourceId: meta.id,
            sourceRevision: meta.revision,
            evidenceId: meta.id,
            evidenceRevision: meta.revision,
            locator: { kind: 'generated_artifact', type: meta.type },
            effectiveTime: meta.eventTime,
            reviewState: 'unknown',
          },
          content: '',
          readSource,
          validate: async current =>
            (await readSource(current)).status === 'available',
        });
        const reference = referenceOnly(alias);
        const toolReference = toolReferences?.[index];
        if (toolReference) registry.bindToolResearch(toolReference, reference);
        inputs.set(stableJson(reference), reference);
        retained.set(key, reference);
      }
    },
    wrap(tools: readonly EvidenceSearchTool[]): EvidenceSearchTool[] {
      return tools.map(tool => ({
        ...tool,
        async search(request, runtime) {
          const result = await tool.search(request, runtime);
          if (!('status' in result) && !request.signal.aborted) {
            for (const item of result.items) {
              const reference = referenceOnly(item);
              inputs.set(stableJson(reference), reference);
            }
          }
          return result;
        },
      }));
    },
    async capture(signal: AbortSignal) {
      if (incomplete) throw new Error('Research input lineage is unavailable.');
      // Snapshot the set before awaiting reads, so later concurrent searches cannot alter this query's ancestry.
      const references = [...inputs.values()];
      return (await captureEvidenceSources(references, registry, signal))
        .sources;
    },
    async revalidate(signal: AbortSignal) {
      const references = [...inputs.values()];
      return (
        !incomplete &&
        !signal.aborted &&
        (!references.length ||
          (await registry.revalidateEvidence(references, signal)))
      );
    },
  };
}
