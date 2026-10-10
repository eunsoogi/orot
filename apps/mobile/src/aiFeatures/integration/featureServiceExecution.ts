import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
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

/** Keeps tool scope and provider payloads identical across the owned AI routes. */
export function toolsFor(
  snapshot: LocalEvidenceSnapshot,
  data: AiFeatureLocalData,
) {
  return [
    createLocalEvidenceSearchTool({
      id: 'local-personal-records',
      sourceKind: 'personal_record',
      snapshot,
      rag: data.rag,
    }),
    createLocalEvidenceSearchTool({
      id: 'local-reviewed-memory',
      sourceKind: 'reviewed_memory',
      snapshot,
      rag: data.rag,
    }),
  ] as const;
}

export function executionOptions(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly operationRunId: string;
  readonly consent: MultiAgentWorkflowOptions['consent'];
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly tools: readonly EvidenceSearchTool[];
}) {
  return {
    execution: {
      operationRunId: input.operationRunId,
      providerId: input.selected.provider.id,
      modelId: input.selected.modelId,
      recipient: input.selected.recipient,
      remoteProcessing: input.selected.remoteProcessing,
      allowedScope: {
        sourceKinds: ['personal_record', 'reviewed_memory'] as const,
      },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider: input.selected.provider,
    tools: input.tools,
    consent: input.consent,
    revalidateEvidence: (
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) => input.registry.revalidateEvidence(references, signal),
  };
}
