import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentCheckpointState,
  type MultiAgentWorkflowOptions,
} from '../src';

const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'record-revision-1',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-revision-1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00Z',
  unit: 'mmHg',
  reviewState: 'reviewed',
};

const evidence: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic blood pressure: 120/80 mmHg.' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function workflowOptions(
  provider: LanguageModelProvider,
  revalidateEvidence: MultiAgentWorkflowOptions['revalidateEvidence'],
  restoreEvidence: NonNullable<MultiAgentWorkflowOptions['restoreEvidence']>,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'run-checkpoint-projection',
      providerId: provider.id,
      modelId: 'model-checkpoint-projection',
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
    revalidateEvidence,
    restoreEvidence,
  };
}

describe('multi-agent checkpoint projection', () => {
  it('projects restored references before freshness checks and checkpoint output', async () => {
    const privateValue = 'SYNTHETIC_RESTORED_TRANSCRIPT';
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
      generate: async () =>
        providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { summary: 'Question list.' },
            citations: [reference],
          }),
          toolCalls: [],
          finishReason: 'complete',
        }),
    };
    const revalidateEvidence = jest.fn(async () => true);
    const restoreEvidence = jest.fn(async () => evidence);
    const options = workflowOptions(provider, revalidateEvidence, restoreEvidence);
    const unsafeReference = {
      ...reference,
      rawTranscript: privateValue,
    } as unknown as EvidenceReference;
    const saved: MultiAgentCheckpointState = {
      operationRunId: options.execution.operationRunId,
      providerId: options.execution.providerId,
      modelId: options.execution.modelId,
      allowedScope: options.execution.allowedScope,
      budget: options.execution.budget,
      phase: 'revised_response',
      modelCalls: 1,
      toolCalls: 1,
      researchCycles: 1,
      evidenceReferences: [unsafeReference],
      terminal: false,
    };

    const result = await runMultiAgentWorkflow(options, { resumeFrom: saved });

    expect(revalidateEvidence).toHaveBeenCalledWith([reference], expect.any(AbortSignal));
    expect(restoreEvidence).toHaveBeenCalledWith([reference], expect.any(AbortSignal));
    expect(result.status).toBe('result');
    expect(result.checkpoint.evidenceReferences).toEqual([reference]);
    expect(JSON.stringify(result.checkpoint)).not.toContain(privateValue);
  });
});
