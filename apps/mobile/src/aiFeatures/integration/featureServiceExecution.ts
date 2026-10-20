import type { createExternalConversationEvidence } from './externalConversationEvidence';
import { EVIDENCE_WORKFLOW_BUDGET } from '../../agent/evidenceWorkflowBudget';
import { RAG_CONVERSATION_BUDGET } from '../../ragConversation/budget';
import { providerDiagnostic } from '../../providers/diagnostics';
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
import { createHealthContextTool } from './healthContextTool';
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
  localResultLimit?: number,
  healthOverview = false,
  feature: 'disease' | 'rag' = 'disease',
) {
  return [
    ...(data.readHealthContext
      ? [createHealthContextTool(data.readHealthContext, registry, feature)]
      : []),
    createLocalEvidenceSearchTool({
      id: 'local-personal-records',
      sourceKind: 'personal_record',
      maxResults: localResultLimit,
      snapshot,
      registry,
      allowHealthOverview: healthOverview,
      rag: data.rag,
      async loadSnapshot(query, request) {
        const scope = request.allowedScope;
        const next = await loadFeatureEvidenceSnapshot(
          data,
          registry,
          request.signal,
          query,
          {
            ...(request.input.view === 'health_overview'
              ? { selection: 'health_overview' as const }
              : {}),
            ...(scope.sourceIds
              ? { sourceIds: registry.localSourceIds(scope.sourceIds) }
              : {}),
            ...(scope.timeRange ? { timeRange: scope.timeRange } : {}),
          },
        );
        // Overview selection is SQL-ordered by topic and does not use embedding ranking.
        if (request.input.view === 'health_overview')
          providerDiagnostic(feature, 'data', 'overview_selected');
        if (request.input.view !== 'health_overview')
          await indexChangedFeatureEvidence(data, next, request.signal);
        return next;
      },
    }),
    createLocalEvidenceSearchTool({
      id: 'local-reviewed-memory',
      sourceKind: 'reviewed_memory',
      maxResults: localResultLimit,
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
  readonly medicalExplanation?: boolean;
  readonly consentPurpose:
    'symptom_summary' | 'disease_hypotheses' | 'record_conversation';
}) {
  return {
    execution: {
      operationRunId: input.operationRunId,
      providerId: input.selected.provider.id,
      modelId: input.selected.modelId,
      recipient: input.selected.recipient,
      remoteProcessing: input.selected.remoteProcessing,
      consentScope: {
        purpose: input.consentPurpose,
        dataCategories: [
          'health_records',
          'reviewed_memory',
          'conversation',
          ...(input.external ? ['medical_literature'] : []),
        ],
        policyVersion: 'local-records-v1',
      },
      allowedScope: {
        sourceKinds: input.external
          ? ([
              'personal_record',
              'reviewed_memory',
              'external_medical',
            ] as const)
          : (['personal_record', 'reviewed_memory'] as const),
      },
      // Both local and literature tools need time for retrieval plus a cited answer.
      budget: input.medicalExplanation
        ? {
            ...EVIDENCE_WORKFLOW_BUDGET,
            maxModelCalls: 4,
            maxOutputTokens: 1024,
          }
        : input.external
          ? RAG_CONVERSATION_BUDGET
          : EVIDENCE_WORKFLOW_BUDGET,
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
