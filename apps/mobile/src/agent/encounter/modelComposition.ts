import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { EncounterModelOptions } from './extraction';
import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';
import { EVIDENCE_WORKFLOW_BUDGET } from '../evidenceWorkflowBudget';

/** Keep the selected recording as the payload scope and use its attempt nonce for the workflow identity. */
export function composeEncounterModel(
  sourceId: string,
  executionId: string,
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  consent: ExecutionConsentPort,
): EncounterModelOptions {
  return {
    provider: selected.provider,
    consent,
    execution: {
      operationRunId: executionId,
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: selected.remoteProcessing,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
      consentScope: {
        purpose: 'encounter_transcript_review',
        dataCategories: ['selected_recording_transcript'],
        policyVersion: 'single-recording-v1',
      },
    },
  };
}

/** Recovery and approval cannot dispatch a model, even if a checkpoint is interrupted. */
export function encounterReadOnlyModel(
  sourceId: string,
): EncounterModelOptions {
  return {
    provider: {
      id: 'encounter-resume',
      kind: 'language-model',
      displayName: 'Local review recovery',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: async () => {
        throw new Error('Recovery cannot extract.');
      },
    },
    consent: { authorize: async () => 'renewal_required' },
    execution: {
      operationRunId: 'encounter-resume',
      providerId: 'encounter-resume',
      modelId: 'none',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      budget: EVIDENCE_WORKFLOW_BUDGET,
    },
  };
}
