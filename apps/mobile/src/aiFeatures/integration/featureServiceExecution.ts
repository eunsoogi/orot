import type { createExternalConversationEvidence } from './externalConversationEvidence';
import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { RAG_CONVERSATION_BUDGET } from '../../ragConversation/budget';
import type {
  EvidenceReference,
  EvidenceSearchTool,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { AiFeatureLocalData } from './localData';
import { createLocalEvidenceSearchTool } from './evidenceSearchTool';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import { requireSelectedAi } from './provider';
import {
  indexChangedFeatureEvidence,
  loadFeatureEvidenceSnapshot,
  loadFeatureMemorySnapshot,
} from './featureEvidenceSnapshot';

/** Keeps tool scope and provider payloads identical across the owned AI routes. */
export function toolsFor(
  snapshot: LocalEvidenceSnapshot | undefined,
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
) {
  return [
    createLocalEvidenceSearchTool({
      id: 'local-personal-records',
      sourceKind: 'personal_record',
      snapshot,
      rag: data.rag,
      async loadSnapshot(query, request) {
        const scope = request.allowedScope;
        const next = await loadFeatureEvidenceSnapshot(
          data,
          registry,
          request.signal,
          query,
          {
            ...(scope.sourceIds
              ? { sourceIds: registry.localSourceIds(scope.sourceIds) }
              : {}),
            ...(scope.timeRange ? { timeRange: scope.timeRange } : {}),
          },
        );
        await indexChangedFeatureEvidence(data, next, request.signal);
        return next;
      },
    }),
    createLocalEvidenceSearchTool({
      id: 'local-reviewed-memory',
      sourceKind: 'reviewed_memory',
      snapshot,
      rag: data.rag,
      async loadSnapshot(_query, request) {
        const next = await loadFeatureMemorySnapshot(
          data,
          registry,
          request.signal,
        );
        await indexChangedFeatureEvidence(data, next, request.signal);
        return next;
      },
    }),
  ] as const;
}

export function executionOptions(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly operationRunId: string;
  readonly consent: MultiAgentWorkflowOptions['consent'];
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly tools: readonly EvidenceSearchTool[];
  readonly external?: ReturnType<typeof createExternalConversationEvidence>;
}) {
  return {
    execution: {
      operationRunId: input.operationRunId,
      providerId: input.selected.provider.id,
      modelId: input.selected.modelId,
      recipient: input.selected.recipient,
      remoteProcessing: input.selected.remoteProcessing,
      allowedScope: {
        sourceKinds: input.external
          ? ([
              'personal_record',
              'reviewed_memory',
              'external_medical',
            ] as const)
          : (['personal_record', 'reviewed_memory'] as const),
      },
      // Only the literature-enabled conversation opts into the longer finite deadline.
      budget: input.external
        ? RAG_CONVERSATION_BUDGET
        : DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider: input.selected.provider,
    tools: input.tools,
    consent: input.consent,
    revalidateEvidence: (
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) => {
      if (signal.aborted || references.length === 0)
        return Promise.resolve(false);
      const external = references.filter(
        reference => reference.sourceKind === 'external_medical',
      );
      if (external.some(reference => !input.external?.validates(reference)))
        return Promise.resolve(false);
      const local = references.filter(
        reference => reference.sourceKind !== 'external_medical',
      );
      return local.length
        ? input.registry.revalidateEvidence(local, signal)
        : Promise.resolve(true);
    },
  };
}
