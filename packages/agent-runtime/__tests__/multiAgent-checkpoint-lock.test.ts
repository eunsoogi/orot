import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
import { runMultiAgentWorkflow, type EvidenceBatch, type MultiAgentWorkflowOptions } from '../src';

const noEvidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeProvider(started: { resolve: (value: void) => void }, release: Promise<void>) {
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
      started.resolve(undefined);
      await release;
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Question list.' },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    }),
  };
  return provider;
}

function workflowOptions(
  provider: LanguageModelProvider,
  timeoutMs = 5000,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'run-checkpoint-lock',
      providerId: provider.id,
      modelId: 'model-checkpoint-lock',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32000,
        maxOutputTokens: 512,
        timeoutMs,
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
    initialEvidence: noEvidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

describe('checkpoint thread lock cancellation', () => {
  it('returns a queued cancellation promptly without letting the next caller overtake', async () => {
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<void>();
    const provider = makeProvider(providerStarted, releaseProvider.promise);
    const saver = new MemorySaver();
    const options = { ...workflowOptions(provider), checkpointer: saver };
    const config = { configurable: { thread_id: 'queued-cancellation' } };
    const first = runMultiAgentWorkflow(options, { config });
    await providerStarted.promise;

    const controller = new AbortController();
    const cancelledRun = runMultiAgentWorkflow(options, { config, signal: controller.signal });
    controller.abort();
    const cancelledBeforeRelease = await settlesWithin(cancelledRun, 100);
    const followingRun = runMultiAgentWorkflow(options, { config });
    const followingBeforeRelease = await settlesWithin(followingRun, 40);

    releaseProvider.resolve(undefined);
    const [firstResult, cancelledResult, followingResult] = await Promise.all([
      first,
      cancelledRun,
      followingRun,
    ]);

    expect(cancelledBeforeRelease).toMatchObject({ status: 'cancelled' });
    expect(followingBeforeRelease).toBeUndefined();
    expect(firstResult.status).not.toBe('cancelled');
    expect(cancelledResult.status).toBe('cancelled');
    expect(followingResult.status).toBe('stale_evidence');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('counts queued time toward the execution budget and keeps later callers ordered', async () => {
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<void>();
    const provider = makeProvider(providerStarted, releaseProvider.promise);
    const saver = new MemorySaver();
    const config = { configurable: { thread_id: 'queued-timeout' } };
    const options = { ...workflowOptions(provider), checkpointer: saver };
    const first = runMultiAgentWorkflow(options, { config });
    await providerStarted.promise;

    const shortBudget = {
      ...options,
      execution: {
        ...options.execution,
        budget: { ...options.execution.budget, timeoutMs: 40 },
      },
    };
    const timedRun = runMultiAgentWorkflow(shortBudget, { config });
    const timedBeforeRelease = await settlesWithin(timedRun, 200);
    const followingRun = runMultiAgentWorkflow(options, { config });
    const followingBeforeRelease = await settlesWithin(followingRun, 40);

    releaseProvider.resolve(undefined);
    const [firstResult, timedResult, followingResult] = await Promise.all([
      first,
      timedRun,
      followingRun,
    ]);

    expect(timedBeforeRelease).toMatchObject({ status: 'budget_exceeded' });
    expect(followingBeforeRelease).toBeUndefined();
    expect(firstResult.status).not.toBe('cancelled');
    expect(timedResult.status).toBe('budget_exceeded');
    expect(followingResult.status).toBe('stale_evidence');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});
