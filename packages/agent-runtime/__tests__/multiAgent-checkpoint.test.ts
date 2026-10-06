import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type MultiAgentCheckpointState,
  type MultiAgentBudget,
  type MultiAgentWorkflowOptions,
} from '../src';

function checkpointOptions(
  provider: LanguageModelProvider,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'run-checkpoint-1',
      providerId: provider.id,
      modelId: 'model-checkpoint-1',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32000,
        maxOutputTokens: 512,
        timeoutMs: 5000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: 'Prepare synthetic visit questions.',
    task: {
      taskType: 'synthetic-visit-questions',
      taskVersion: '1',
      systemPrompt: 'Return a cautious, evidence-linked result.',
      resultSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
      createMessages: () => [{ role: 'user', content: 'Prepare the requested questions.' }],
      validateResult: () => ({ status: 'valid', value: { summary: 'Question list.' } }),
    },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

describe('multi-agent checkpoint boundaries', () => {
  it('fails closed on an in-flight checkpoint instead of repeating its model call', async () => {
    const generate = jest.fn(async () =>
      providerSuccess({ text: '{}', toolCalls: [], finishReason: 'complete' }),
    );
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-model',
      displayName: 'Selected model',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    };
    const options = checkpointOptions(provider);
    const saved: MultiAgentCheckpointState = {
      operationRunId: options.execution.operationRunId,
      providerId: options.execution.providerId,
      modelId: options.execution.modelId,
      allowedScope: options.execution.allowedScope,
      budget: options.execution.budget,
      phase: 'task_response',
      modelCalls: 1,
      toolCalls: 0,
      researchCycles: 0,
      evidenceReferences: [],
      pendingOperation: { kind: 'model', operationKey: 'model-1' },
      terminal: false,
    };

    const result = await runMultiAgentWorkflow(options, { resumeFrom: saved });

    expect(result.status).toBe('stale_evidence');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a budget with a missing guardrail before any model call', async () => {
    const generate = jest.fn(async () =>
      providerSuccess({ text: '{}', toolCalls: [], finishReason: 'complete' }),
    );
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-model',
      displayName: 'Selected model',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    };
    const options = checkpointOptions(provider);
    const budget = Object.fromEntries(
      Object.entries(options.execution.budget).filter(([key]) => key !== 'maxModelCalls'),
    ) as unknown as MultiAgentBudget;
    const malformed = {
      ...options,
      execution: { ...options.execution, budget },
    };

    const result = await runMultiAgentWorkflow(malformed);

    expect(result.status).toBe('invalid_output');
    expect(generate).not.toHaveBeenCalled();
  });
});
