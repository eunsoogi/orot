import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { HealthReviewModel } from '../agent/healthReview/port';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import { EVIDENCE_WORKFLOW_BUDGET } from '../agent/evidenceWorkflowBudget';

let operation = 0;
export const healthReviewConsentScope = {
  purpose: 'health_review',
  dataCategories: ['health_records'],
  policyVersion: 'health-review-v1',
} as const;

/** Scope covers only the graph's standard personal-record tools; request notes are not a source filter. */
export function composeHealthReviewModel(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  consent: ExecutionConsentPort,
): HealthReviewModel {
  return {
    provider: selected.provider,
    consent,
    execution: {
      operationRunId: 'health-review-operation-' + ++operation,
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: selected.remoteProcessing,
      consentScope: healthReviewConsentScope,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
    },
  };
}

/** A deterministic safety interrupt/action remains available when no provider is selected. */
export function healthReviewReadOnlyModel(): HealthReviewModel {
  const id = 'health-review-local-safety';
  return {
    provider: {
      id,
      kind: 'language-model',
      displayName: 'Local safety policy',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: async () => {
        throw new Error('Local safety cannot dispatch inference.');
      },
    },
    consent: { authorize: async () => 'renewal_required' },
    execution: {
      operationRunId: id,
      providerId: id,
      modelId: 'none',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
    },
  };
}
