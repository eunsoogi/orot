import type { ToolScopeReceipt } from './toolReferenceScopeSnapshot';
import {
  snapshotResearchInputs,
  restoreResearchInputs,
  type ResearchInputTrackerSnapshot,
} from './researchInputTrackerSnapshot';
import { wrapEvidenceSearch } from './wrapEvidenceSearch';
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
  sessionId?: string,
  recovery?: {
    readonly snapshot: ResearchInputTrackerSnapshot;
    readonly scope?: {
      readonly operationRunId: string;
      readonly receipt: ToolScopeReceipt;
    };
  },
) {
  const restored = recovery
    ? restoreResearchInputs(recovery.snapshot, registry)
    : undefined;
  const inputs = restored?.inputs ?? new Map<string, EvidenceReference>();
  const retained = restored?.retained ?? new Map<string, EvidenceReference>();
  let incomplete = restored?.incomplete ?? false;
  // A restored input list alone cannot recreate call-scoped research source bindings.
  // Only a verified scope receipt from this same fresh registry can unblock those queries.
  const scopeUnavailable = () =>
    Boolean(
      recovery &&
      (!sessionId ||
        !recovery.scope ||
        !registry.toolReferences.acceptsScopeReceipt(
          recovery.scope.receipt,
          { sessionId, operationRunId: recovery.scope.operationRunId },
          [...retained.values()],
        )),
    );
  return {
    snapshot(): ResearchInputTrackerSnapshot {
      return snapshotResearchInputs(registry, inputs, retained, incomplete);
    },
    async recordResearch(
      ids: readonly number[],
      signal: AbortSignal,
      toolReferences?: readonly import('@orot/agent-runtime').ToolSourceReference[],
      scope?: import('./toolReferenceIndex').RunCallIdentity,
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
          if (toolReference && scope && sessionId)
            registry.toolReferences.bindResearch(toolReference, existing, {
              ...scope,
              sessionId,
            });
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
        if (toolReference && scope && sessionId)
          registry.toolReferences.bindResearch(toolReference, reference, {
            ...scope,
            sessionId,
          });
        inputs.set(stableJson(reference), reference);
        retained.set(key, reference);
      }
    },
    wrap(tools: readonly EvidenceSearchTool[]): EvidenceSearchTool[] {
      return tools.map(tool =>
        wrapEvidenceSearch(tool, async (request, _runtime, dispatch) => {
          const result = await dispatch();
          if (!('status' in result) && !request.signal.aborted) {
            for (const item of result.items) {
              const reference = referenceOnly(item);
              inputs.set(stableJson(reference), reference);
            }
          }
          return result;
        }),
      );
    },
    async capture(signal: AbortSignal) {
      if (incomplete || scopeUnavailable())
        throw new Error('Research input lineage is unavailable.');
      // Snapshot the set before awaiting reads, so later concurrent searches cannot alter this query's ancestry.
      const references = [...inputs.values()];
      return (await captureEvidenceSources(references, registry, signal))
        .sources;
    },
    async revalidate(signal: AbortSignal) {
      const references = [...inputs.values()];
      return (
        !incomplete &&
        !scopeUnavailable() &&
        !signal.aborted &&
        (!references.length ||
          (await registry.revalidateEvidence(references, signal)))
      );
    },
  };
}
