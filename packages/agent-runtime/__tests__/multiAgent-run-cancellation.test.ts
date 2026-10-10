import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
import { runMultiAgentWorkflow, type EvidenceBatch, type MultiAgentWorkflowOptions } from '../src';

const noEvidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };

function cancellationOptions(
  provider: LanguageModelProvider,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'run-cancel-checkpoint-1',
      providerId: provider.id,
      modelId: 'model-cancel-checkpoint-1',
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
    initialEvidence: noEvidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function resolvesWithin<T>(promise: Promise<T>, timeoutMs = 50): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function makeProvider(
  generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({ type: 'result', value: { summary: 'Question list.' }, citations: [] }),
      toolCalls: [],
      finishReason: 'complete',
    }),
  ),
) {
  const languageModel: LanguageModelProvider = {
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
  return { languageModel, generate };
}

describe('multi-agent cancellation during checkpoint waits', () => {
  it('returns cancellation while the persisted-state lookup is still pending', async () => {
    const { languageModel, generate } = makeProvider();
    const saver = new MemorySaver();
    const started = deferred<void>();
    const release = deferred<Awaited<ReturnType<typeof saver.getTuple>>>();
    const original = saver.getTuple.bind(saver);
    let delayFirstRead = true;
    jest.spyOn(saver, 'getTuple').mockImplementation(async (...args) => {
      if (delayFirstRead) {
        delayFirstRead = false;
        started.resolve(undefined);
        return release.promise;
      }
      return original(...args);
    });
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(
      { ...cancellationOptions(languageModel), checkpointer: saver },
      { config: { configurable: { thread_id: 'cancel-get-state' } }, signal: controller.signal },
    );

    await started.promise;
    controller.abort();
    const observed = await resolvesWithin(pending);
    release.resolve(undefined);
    await pending;

    expect(observed).toMatchObject({ status: 'cancelled', downstreamDispatchStopped: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('handles a checkpoint rejection when lookup aborts before observation attaches', async () => {
    const { languageModel, generate } = makeProvider();
    const saver = new MemorySaver();
    const controller = new AbortController();
    const getTuple = jest.spyOn(saver, 'getTuple').mockImplementation(async () => {
      controller.abort();
      throw new Error('Checkpoint read failed after cancellation.');
    });
    const unhandledRejections: unknown[] = [];
    const captureUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

    // Cancellation can settle the workflow before the started checkpoint promise rejects.
    process.on('unhandledRejection', captureUnhandledRejection);
    try {
      const result = await runMultiAgentWorkflow(
        { ...cancellationOptions(languageModel), checkpointer: saver },
        {
          config: { configurable: { thread_id: 'cancel-get-state-rejection' } },
          signal: controller.signal,
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(result).toMatchObject({ status: 'cancelled', downstreamDispatchStopped: true });
      expect(getTuple).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandledRejection);
    }
  });

  it('returns cancellation while the pending-operation write is still pending', async () => {
    const { languageModel, generate } = makeProvider();
    const saver = new MemorySaver();
    const started = deferred<void>();
    const release = deferred<void>();
    const persist = saver.put.bind(saver);
    let held = false;
    jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
      const [, checkpoint] = args;
      const channels = checkpoint.channel_values as Record<string, unknown>;
      const pending = channels.pendingOperation as { kind?: string } | undefined;
      if (!held && channels.modelCalls === 1 && pending?.kind === 'model') {
        held = true;
        started.resolve(undefined);
        await release.promise;
      }
      return persist(...args);
    });
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(
      { ...cancellationOptions(languageModel), checkpointer: saver },
      {
        config: { configurable: { thread_id: 'cancel-pending-write' } },
        signal: controller.signal,
      },
    );

    await started.promise;
    controller.abort();
    const observed = await resolvesWithin(pending);
    release.resolve(undefined);
    await pending;

    expect(observed).toMatchObject({ status: 'cancelled', downstreamDispatchStopped: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not return a result while the final checkpoint write is still pending', async () => {
    const { languageModel, generate } = makeProvider();
    const saver = new MemorySaver();
    const started = deferred<void>();
    const release = deferred<void>();
    const settled = deferred<void>();
    const persist = saver.put.bind(saver);
    let held = false;
    jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
      const [, checkpoint] = args;
      const channels = checkpoint.channel_values as Record<string, unknown>;
      if (!held && channels.phase === 'complete' && channels.terminal === true) {
        held = true;
        started.resolve(undefined);
        await release.promise;
      }
      try {
        return await persist(...args);
      } finally {
        if (held) settled.resolve(undefined);
      }
    });
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(
      { ...cancellationOptions(languageModel), checkpointer: saver },
      { config: { configurable: { thread_id: 'cancel-final-write' } }, signal: controller.signal },
    );

    await started.promise;
    controller.abort();
    const observed = await resolvesWithin(pending);
    release.resolve(undefined);
    await settled.promise;
    await pending;

    expect(observed).toMatchObject({ status: 'cancelled', downstreamDispatchStopped: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
