import type { createExternalConversationEvidence } from './externalConversationEvidence';
import { EVIDENCE_WORKFLOW_BUDGET } from '../../agent/evidenceWorkflowBudget';
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
import { evidenceConsentScope } from './evidenceConsentScope';
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
      ? [
          // Only ordinary conversation opts into pre-dispatch refresh. The RAG
          // input schema is also used by health summaries, which keep their own
          // single-read freshness contract.
          createHealthContextTool(
            data.readHealthContext,
            registry,
            feature,
            feature === 'rag',
          ),
        ]
      : []),
    createLocalEvidenceSearchTool({
      id: 'local-personal-records',
      sourceKind: 'personal_record',
      maxResults: localResultLimit,
      snapshot,
      registry,
      allowHealthOverview: healthOverview,
      rag: data.rag,
      prepareChunks: (chunks, signal) =>
        indexChangedFeatureEvidence(data, { chunks }, signal),
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
        return next;
      },
    }),
    createLocalEvidenceSearchTool({
      id: 'local-reviewed-memory',
      sourceKind: 'reviewed_memory',
      maxResults: localResultLimit,
      snapshot,
      rag: data.rag,
      prepareChunks: (chunks, signal) =>
        indexChangedFeatureEvidence(data, { chunks }, signal),
      async loadSnapshot(_query, request) {
        const next = await loadFeatureMemorySnapshot(
          data,
          registry,
          request.signal,
        );
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
  readonly external?: Pick<
    ReturnType<typeof createExternalConversationEvidence>,
    'validates'
  > & {
    readonly usesPublicWeb?: boolean;
  };
  readonly medicalExplanation?: boolean;
  readonly consentPurpose:
    'symptom_summary' | 'disease_hypotheses' | 'record_conversation';
}) {
  const generatedArtifacts = input.tools.some(
    tool => tool.sourceKind === 'generated_artifact',
  );
  return {
    execution: {
      operationRunId: input.operationRunId,
      providerId: input.selected.provider.id,
      modelId: input.selected.modelId,
      recipient: input.selected.recipient,
      remoteProcessing: input.selected.remoteProcessing,
      consentScope: evidenceConsentScope({
        purpose: input.consentPurpose,
        generatedArtifacts,
        external: Boolean(input.external),
        publicWeb: Boolean(input.external?.usesPublicWeb),
      }),
      allowedScope: {
        sourceKinds: [
          'personal_record' as const,
          'reviewed_memory' as const,
          ...(generatedArtifacts ? (['generated_artifact'] as const) : []),
          ...(input.external ? (['external_medical'] as const) : []),
        ],
      },
      // Both local and literature tools need time for retrieval plus a cited answer.
      budget: {
        ...EVIDENCE_WORKFLOW_BUDGET,
        ...(input.consentPurpose === 'record_conversation'
          ? { maxAccumulatedEvidenceItems: null }
          : {}),
      },
    },
    provider: input.selected.provider,
    tools: input.tools,
    consent: input.consent,
    revalidateEvidence: (
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) => {
      if (signal.aborted) return Promise.resolve(false);
      // A completed empty lookup has no source revision to invalidate. Coverage
      // and task grounding still decide whether this evidence can support an answer.
      if (references.length === 0) return Promise.resolve(true);
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
