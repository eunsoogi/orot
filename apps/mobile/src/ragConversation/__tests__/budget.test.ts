import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { executionOptions } from '../../aiFeatures/integration/featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createExternalConversationEvidence } from '../../aiFeatures/integration/externalConversationEvidence';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { RAG_CONVERSATION_BUDGET } from '../budget';
import { EVIDENCE_WORKFLOW_BUDGET } from '../../agent/evidenceWorkflowBudget';

test('shipping evidence workflows share the bounded 90-second profile', () => {
  const option = createAppleSelectionOption('available');
  const input = {
    selected: {
      status: 'ready' as const,
      option,
      provider: option.provider,
      modelId: option.modelId,
      selection: { providerId: option.provider.id, modelId: option.modelId },
      recipient: 'on-device',
      remoteProcessing: false,
    },
    operationRunId: 'budget-test',
    consent: { authorize: async () => 'authorized' as const },
    registry: new LocalEvidenceReferenceRegistry(),
    tools: [],
  };
  const external = createExternalConversationEvidence({
    search: async () => ({ status: 'empty' }),
  });
  expect(executionOptions(input).execution.budget).toBe(
    EVIDENCE_WORKFLOW_BUDGET,
  );
  expect(executionOptions({ ...input, external }).execution.budget).toBe(
    RAG_CONVERSATION_BUDGET,
  );
  expect(RAG_CONVERSATION_BUDGET).toEqual({
    ...DEFAULT_MULTI_AGENT_BUDGET,
    timeoutMs: 90_000,
  });
});
