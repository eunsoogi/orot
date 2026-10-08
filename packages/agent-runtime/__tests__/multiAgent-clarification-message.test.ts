import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const message = '진료 전에 최신 혈당 기록 날짜를 확인해 주세요.';
const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'record-rev-1',
  evidenceId: 'glucose-1',
  evidenceRevision: 'glucose-rev-1',
  locator: { kind: 'structured_record', recordId: 'glucose-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  unit: 'mg/dL',
  reviewState: 'reviewed',
};
const evidence: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic glucose result, 110 mg/dL.' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function clarificationTask(): TaskResponderContract<{ checked: boolean }> {
  return {
    taskType: 'synthetic-clarification',
    taskVersion: '1',
    systemPrompt: 'Return one evidence-linked result.',
    resultSchema: { type: 'object', additionalProperties: false },
    createMessages: () => [{ role: 'user', content: 'Check the synthetic result.' }],
    // This safe copy is produced by task validation, not forwarded from model output.
    validateResult: () => ({ status: 'needs_clarification', message }),
  };
}

function optionsFor(provider: LanguageModelProvider): MultiAgentWorkflowOptions {
  return {
    execution: {
      operationRunId: 'clarification-message-run',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider,
    request: 'Check the synthetic result.',
    task: clarificationTask(),
    initialEvidence: evidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

describe('multi-agent clarification message', () => {
  it('preserves task validation copy in the terminal workflow result', async () => {
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-provider',
      displayName: 'Selected provider',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: async () =>
        providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { checked: true },
            citations: [reference],
          }),
          toolCalls: [],
          finishReason: 'complete',
        }),
    };

    const result = await runMultiAgentWorkflow(optionsFor(provider));

    expect(result).toMatchObject({ status: 'needs_clarification', message });
  });
});
