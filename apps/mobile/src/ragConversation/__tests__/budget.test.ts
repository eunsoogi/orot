import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { executionOptions } from '../../aiFeatures/integration/featureServiceExecution';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createExternalConversationEvidence } from '../../aiFeatures/integration/externalConversationEvidence';
import { createAppleSelectionOption } from '../../providers/selection/options';
import { RAG_CONVERSATION_BUDGET } from '../budget';

test('shipping literature conversations opt into the shared 90-second profile while other routes keep 45 seconds', () => {
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
    DEFAULT_MULTI_AGENT_BUDGET,
  );
  expect(executionOptions({ ...input, external }).execution.budget).toBe(
    RAG_CONVERSATION_BUDGET,
  );
  expect(RAG_CONVERSATION_BUDGET).toEqual({
    ...DEFAULT_MULTI_AGENT_BUDGET,
    timeoutMs: 90_000,
  });
});
