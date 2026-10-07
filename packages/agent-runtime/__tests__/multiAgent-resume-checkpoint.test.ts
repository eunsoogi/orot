import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
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
  sourceRevision: 'record-rev-1',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-rev-1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
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

function makeRun(events: string[]) {
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
    generate: jest.fn(async () => {
      events.push('provider');
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Prepared.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    }),
  };
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'run-resume-checkpoint-1',
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
      validateResult: () => ({ status: 'valid', value: { summary: 'Prepared.' } }),
    },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    restoreEvidence: async () => evidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
  const resumeFrom: MultiAgentCheckpointState = {
    operationRunId: options.execution.operationRunId,
    providerId: options.execution.providerId,
    modelId: options.execution.modelId,
    allowedScope: options.execution.allowedScope,
    budget: options.execution.budget,
    phase: 'revised_response',
    modelCalls: 2,
    toolCalls: 1,
    researchCycles: 1,
    evidenceReferences: [reference],
    pendingOperation: undefined,
    terminal: false,
  };
  return { options, provider, resumeFrom };
}

describe('multi-agent resumed checkpoint persistence', () => {
  it('persists a pending operation before dispatch and rejects reuse of the consumed resume state', async () => {
    const events: string[] = [];
    const saver = new MemorySaver();
    const persist = saver.put.bind(saver);
    jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
      const [config, checkpoint, metadata, newVersions] = args;
      const channels = checkpoint.channel_values as Record<string, unknown>;
      const pending = channels.pendingOperation as { kind?: string } | undefined;
      if (pending?.kind === 'model') {
        await persist(config, checkpoint, metadata, newVersions);
        events.push('pending-persisted');
        return config;
      }
      return persist(config, checkpoint, metadata, newVersions);
    });
    const { options, provider, resumeFrom } = makeRun(events);
    const invocation = { config: { configurable: { thread_id: 'resume-checkpoint-1' } } };

    const result = await runMultiAgentWorkflow(
      { ...options, checkpointer: saver },
      {
        ...invocation,
        resumeFrom,
      },
    );
    const providerCallsAtCompletion = (provider.generate as jest.Mock).mock.calls.length;
    const replay = await runMultiAgentWorkflow(
      { ...options, checkpointer: saver },
      {
        ...invocation,
        resumeFrom,
      },
    );

    expect(result.status).toBe('result');
    expect(events.indexOf('pending-persisted')).toBeLessThan(events.indexOf('provider'));
    expect(providerCallsAtCompletion).toBe(1);
    expect(replay.status).toBe('stale_evidence');
    expect((provider.generate as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('does not dispatch when persisting a resumed pending operation fails', async () => {
    const events: string[] = [];
    const saver = new MemorySaver();
    const persist = saver.put.bind(saver);
    jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
      const [config, checkpoint, metadata, newVersions] = args;
      const channels = checkpoint.channel_values as Record<string, unknown>;
      const pending = channels.pendingOperation as { kind?: string } | undefined;
      if (pending?.kind === 'model') {
        events.push('pending-write-started');
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error('synthetic resumed checkpoint write failure');
      }
      return persist(config, checkpoint, metadata, newVersions);
    });
    const { options, provider, resumeFrom } = makeRun(events);
    const result = await runMultiAgentWorkflow(
      { ...options, checkpointer: saver },
      { config: { configurable: { thread_id: 'resume-checkpoint-failure-1' } }, resumeFrom },
    );

    expect(events).toEqual(['pending-write-started']);
    expect((provider.generate as jest.Mock).mock.calls).toHaveLength(0);
    expect(result.checkpoint).toMatchObject({ phase: 'complete', terminal: true });
  });

  it('rejects a checkpoint that references deleted evidence before restoring or dispatching', async () => {
    const { options, provider, resumeFrom } = makeRun([]);
    const revalidateEvidence = jest.fn(async () => false);
    const restoreEvidence = jest.fn(async () => evidence);

    const result = await runMultiAgentWorkflow(
      { ...options, revalidateEvidence, restoreEvidence },
      { resumeFrom },
    );

    expect(result.status).toBe('stale_evidence');
    expect(revalidateEvidence).toHaveBeenCalledWith([reference], expect.any(AbortSignal));
    expect(restoreEvidence).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
