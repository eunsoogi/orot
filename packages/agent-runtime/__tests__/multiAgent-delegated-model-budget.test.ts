import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import type { EvidenceSearchTool } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

function fixture(maxModelCalls = 3, waitForPublic?: () => Promise<void>, nativeTools = true) {
  const requests: LanguageModelRequest[] = [];
  const adapter = createEuropePmcEvidenceSearchTool({
    service: {
      search: jest.fn(async () => ({ status: 'available' as const, publications: [publication] })),
    },
    consent: { authorize: async () => 'authorized' },
  });
  let mainCalls = 0;
  const base = makeProvider([]).provider;
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: nativeTools },
    generate: jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      if (
        request.messages[0]?.role === 'user' &&
        request.messages[0].content === 'Public concept only'
      ) {
        await waitForPublic?.();
        return providerSuccess({
          text: 'Synthetic public explanation.',
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      }
      mainCalls++;
      if (!nativeTools) {
        return providerSuccess({
          text: scriptedOutputs()[mainCalls - 1]!,
          toolCalls: [],
          finishReason: 'complete' as const,
        });
      }
      return mainCalls === 1
        ? providerSuccess({
            text: '',
            toolCalls: [
              { id: 'search-call', name: adapter.id, arguments: { query: 'public concept' } },
            ],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: scriptedOutputs()[2]!,
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    }),
  };
  const delegated = jest.fn(async (request: Parameters<typeof adapter.search>[0]) => {
    await provider.generate({ messages: [{ role: 'user', content: 'Public concept only' }] });
    if (request.signal.aborted) throw new Error('Cancelled before downstream search');
    return adapter.search(request);
  });
  const tool = { ...adapter, additionalModelCalls: 1 as const, search: delegated };
  const options = workflowOptions(provider, tool);
  return {
    requests,
    delegated,
    provider,
    options: {
      ...options,
      execution: { ...options.execution, budget: { ...options.execution.budget, maxModelCalls } },
    },
  };
}

test('counts a delegated model request and the final answer inside the same workflow ceiling', async () => {
  const run = fixture();
  const result = await runMultiAgentWorkflow(run.options);
  expect(result.status).toBe('result');
  expect(run.requests).toHaveLength(3);
  expect(result.checkpoint.modelCalls).toBe(3);
  expect(result.checkpoint.toolCalls).toBe(1);
});

test('does not dispatch a delegated request when no final-answer slot remains', async () => {
  const run = fixture(2);
  const result = await runMultiAgentWorkflow(run.options);
  expect(result.status).toBe('budget_exceeded');
  expect(run.delegated).not.toHaveBeenCalled();
  expect(run.requests).toHaveLength(1);
  expect(run.requests[0]?.tools?.map((tool) => tool.name) ?? []).not.toContain(
    run.options.tools[0]!.id,
  );
});

test.each([-1, 0, 2, '1'])(
  'rejects an invalid delegated model cost %s before dispatch',
  async (cost) => {
    const run = fixture();
    const tool = { ...run.options.tools[0]!, additionalModelCalls: cost } as EvidenceSearchTool;
    const result = await runMultiAgentWorkflow({ ...run.options, tools: [tool] });
    expect(result.status).toBe('invalid_output');
    expect(run.requests).toHaveLength(0);
    expect(run.delegated).not.toHaveBeenCalled();
  },
);

test('rejects delegated model work declared as a local read', async () => {
  const run = fixture();
  const tool = { ...run.options.tools[0]!, execution: 'local_read_only' as const };
  const result = await runMultiAgentWorkflow({ ...run.options, tools: [tool] });
  expect(result.status).toBe('invalid_output');
  expect(run.requests).toHaveLength(0);
  expect(run.delegated).not.toHaveBeenCalled();
});

test('reserves both the legacy research planner and delegated request within four calls', async () => {
  const run = fixture(4, undefined, false);
  const result = await runMultiAgentWorkflow(run.options);
  expect(result.status).toBe('result');
  expect(run.requests).toHaveLength(4);
  expect(result.checkpoint.modelCalls).toBe(4);
  expect(run.delegated).toHaveBeenCalledTimes(1);
});

test('rejects an unaffordable legacy research plan before adapter dispatch', async () => {
  const run = fixture(3, undefined, false);
  const result = await runMultiAgentWorkflow(run.options);
  expect(result.status).toBe('budget_exceeded');
  expect(run.requests).toHaveLength(2);
  expect(run.delegated).not.toHaveBeenCalled();
});

test('never reports a potentially active delegated model as not started when cancelling', async () => {
  let started!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = fixture(3, () => {
    started();
    return pending;
  });
  const controller = new AbortController();
  const saver = new MemorySaver();
  const config = { configurable: { thread_id: 'delegated-model-cancellation' } };
  const options = { ...run.options, checkpointer: saver };
  const resultPromise = runMultiAgentWorkflow(options, { config, signal: controller.signal });
  try {
    await didStart;
    // The durable pending operation must reserve the delegated call before it starts.
    // Cancellation's public snapshot intentionally uses the non-resumable starting state.
    const saved = await saver.getTuple(config);
    expect(saved?.checkpoint.channel_values).toMatchObject({
      modelCalls: 2,
      toolCalls: 1,
      pendingOperation: { kind: 'tool' },
    });
    controller.abort();
    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'cancelled',
      providerStop: 'underlying_call_unconfirmed',
      downstreamDispatchStopped: true,
    });
    expect(run.requests).toHaveLength(2);
  } finally {
    controller.abort();
    release();
    await resultPromise;
  }
});
