import { MemorySaver } from '@langchain/langgraph/web';
import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
  type MultiAgentWorkflowOptions,
} from '../src';
import { checkpointFromState, type WorkflowState } from '../src/multiAgent/state';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'synthetic-record',
  sourceRevision: '1',
  evidenceId: 'synthetic-observation',
  evidenceRevision: '1',
  reviewState: 'reviewed' as const,
  effectiveTime: null,
  locator: { kind: 'structured_record' as const, recordId: 'synthetic-observation' },
};

const response = (value: string) =>
  providerSuccess({
    text: JSON.stringify({ type: 'result', value, citations: [reference] }),
    toolCalls: [],
    finishReason: 'complete' as const,
  });

/** Exercise correction through the real graph, consent, deadline and checkpoint boundaries with synthetic responses. */
function fixture(generate: LanguageModelProvider['generate']): MultiAgentWorkflowOptions<string> {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic-correction',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
  return {
    execution: {
      operationRunId: 'correction-run',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs: 5000 },
    },
    provider,
    request: 'Synthetic task',
    task: {
      taskType: 'synthetic',
      taskVersion: '1',
      systemPrompt: 'Synthetic task',
      resultSchema: { type: 'string' },
      createMessages: () => [{ role: 'user', content: 'Synthetic current context' }],
      validateResult: (value) =>
        value === 'valid' ? { status: 'valid', value } : { status: 'invalid', reason: 'format' },
      correctionInstructionForInvalidResult: (reason) =>
        reason === 'format' ? 'Synthetic correction instruction' : undefined,
    },
    initialEvidence: {
      items: [{ ...reference, content: 'Synthetic current evidence' }],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: ['synthetic-record'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

test('counts the one correction and keeps ephemeral guidance out of a completed graph checkpoint', async () => {
  const generate = jest
    .fn()
    .mockResolvedValueOnce(response('invalid'))
    .mockResolvedValueOnce(response('valid'));
  const saver = new MemorySaver();
  const options = { ...fixture(generate), checkpointer: saver };
  const config = { configurable: { thread_id: 'completed-correction' } };
  const result = await runMultiAgentWorkflow(options, { config });
  expect(result.status).toBe('result');
  expect(result.checkpoint.modelCalls).toBe(2);
  expect(result.checkpoint.terminal).toBe(true);
  expect(generate).toHaveBeenCalledTimes(2);
  const tuple = await saver.getTuple(config);
  expect(JSON.stringify(tuple)).not.toContain('Synthetic correction instruction');
  expect(JSON.stringify(tuple)).not.toContain('Synthetic current context');
  const resumed = await runMultiAgentWorkflow(options, { config });
  expect(resumed.status).toBe('stale_evidence');
  expect(generate).toHaveBeenCalledTimes(2);
});

test.each(['deadline', 'caller'] as const)(
  'stops an outstanding correction on %s and refuses replay or a late result',
  async (mode) => {
    let begin!: () => void;
    const began = new Promise<void>((resolve) => {
      begin = resolve;
    });
    let finish!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>((resolve) => {
      finish = resolve;
    });
    let correctionSignal: AbortSignal | undefined;
    const generate = jest
      .fn<
        ReturnType<LanguageModelProvider['generate']>,
        Parameters<LanguageModelProvider['generate']>
      >()
      .mockResolvedValueOnce(response('invalid'))
      .mockImplementationOnce(async (_request, invocation) => {
        correctionSignal = invocation?.signal;
        begin();
        return pending;
      });
    const options = fixture(generate);
    const saver = new MemorySaver();
    const config = { configurable: { thread_id: 'pending-correction-' + mode } };
    const controller = new AbortController();
    const runOptions = {
      ...options,
      checkpointer: saver,
      execution: {
        ...options.execution,
        budget: { ...options.execution.budget, timeoutMs: mode === 'deadline' ? 300 : 5000 },
      },
    };
    const workflow = runMultiAgentWorkflow(runOptions, { config, signal: controller.signal });
    await began;
    // The atomic responder node remains marked in flight during its correction. Resuming it may not redispatch either call.
    const tuple = await saver.getTuple(config);
    const saved = checkpointFromState(tuple!.checkpoint.channel_values as WorkflowState);
    expect(saved.pendingOperation?.kind).toBe('model');
    expect(JSON.stringify(tuple)).not.toContain('Synthetic correction instruction');
    if (mode === 'caller') controller.abort();
    const result = await workflow;
    expect(result.status).toBe(mode === 'deadline' ? 'budget_exceeded' : 'cancelled');
    expect(correctionSignal?.aborted).toBe(true);
    expect(result.checkpoint.terminal).toBe(true);
    const resumed = await runMultiAgentWorkflow(runOptions, { config, resumeFrom: saved });
    expect(resumed.status).toBe('stale_evidence');
    finish(response('valid'));
    await pending;
    expect(result.status).toBe(mode === 'deadline' ? 'budget_exceeded' : 'cancelled');
    expect(generate).toHaveBeenCalledTimes(2);
  },
);

test('rechecks evidence after consent for the correction before its provider dispatch', async () => {
  const generate = jest.fn(async () => response('invalid'));
  const options = fixture(generate);
  let fresh = true;
  let consentCalls = 0;
  // Both responses cite the same synthetic evidence. Only the second consent changes its revision fence.
  generate.mockImplementation(async () =>
    providerSuccess({
      text: JSON.stringify({ type: 'result', value: 'invalid', citations: [reference] }),
      toolCalls: [],
      finishReason: 'complete',
    }),
  );
  const result = await runMultiAgentWorkflow({
    ...options,
    execution: { ...options.execution, remoteProcessing: true },
    initialEvidence: {
      items: [{ ...reference, content: 'Synthetic current evidence' }],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: ['synthetic-record'],
          gaps: [],
          truncated: false,
          resultLimit: 1,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    },
    consent: {
      authorize: async () => {
        if (++consentCalls === 2) fresh = false;
        return 'authorized';
      },
    },
    revalidateEvidence: async () => fresh,
  });
  expect(result.status).toBe('stale_evidence');
  expect(consentCalls).toBe(2);
  expect(generate).toHaveBeenCalledTimes(1);
});

test('a correction-guidance exception stays terminal rather than accepting or regenerating invalid output', async () => {
  const generate = jest.fn(async () => response('invalid'));
  const options = fixture(generate);
  const result = await runMultiAgentWorkflow({
    ...options,
    task: {
      ...options.task,
      correctionInstructionForInvalidResult: () => {
        throw new Error('Synthetic callback error');
      },
    },
  });
  expect(result.status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(1);
});
