import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '../src';
import type { MultiAgentResponderStreamEvent } from '../src';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';
import { publication, scriptedOutputs } from './multiAgent-external-evidence-fixtures';

/** Synthetic provider results exercise the real validation/dispatch order, not model quality. */
test.each(['accepted', 'untrusted medical text'])(
  'admits only task-approved first responses: %s',
  async (text) => {
    const run = standardSearchFixture(true);
    const events: MultiAgentResponderStreamEvent[] = [];
    run.provider.generate.mockImplementation(async (request) => {
      run.requests.push(request);
      return run.requests.length === 1
        ? providerSuccess({
            text,
            toolCalls: [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }],
            finishReason: 'tool_calls',
          })
        : providerSuccess({ text: scriptedOutputs()[2]!, toolCalls: [], finishReason: 'complete' });
    });
    run.search.mockImplementation(async () => {
      expect(events.filter((e) => e.type === 'initial_response')).toHaveLength(
        text === 'accepted' ? 1 : 0,
      );
      return { status: 'available', publications: [publication] };
    });
    const result = await runMultiAgentWorkflow(
      {
        ...run.options,
        task: {
          ...run.options.task,
          initialToolResponse: (value) => (value === 'accepted' ? value : undefined),
        },
      },
      { config: run.config, onTaskStreamEvent: (event) => events.push(event) },
    );
    expect(result.status).toBe('result');
    expect(run.search).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'initial_response')).toEqual(
      text === 'accepted' ? [{ type: 'initial_response', callId: 'first', text }] : [],
    );
  },
);

test('Stop after the initial reply does not execute the requested tool or turn it into an answer', async () => {
  const run = standardSearchFixture(true);
  const controller = new AbortController();
  run.provider.generate.mockResolvedValue(
    providerSuccess({
      text: 'accepted',
      toolCalls: [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }],
      finishReason: 'tool_calls',
    }),
  );
  const result = await runMultiAgentWorkflow(
    { ...run.options, task: { ...run.options.task, initialToolResponse: () => 'accepted' } },
    {
      config: run.config,
      signal: controller.signal,
      onTaskStreamEvent: (event) => {
        if (event.type === 'initial_response') controller.abort();
      },
    },
  );
  expect(result.status).toBe('cancelled');
  expect(run.search).not.toHaveBeenCalled();
});

/** Review responses are synthetic: these assertions prove fences and ordering, not classifier quality. */
test.each(['ALLOW', 'DENY', 'ALLOW.'])(
  'reviews contextual prose before tool dispatch without changing the selected provider: %s',
  async (verdict) => {
    const run = standardSearchFixture(true);
    const events: MultiAgentResponderStreamEvent[] = [];
    const contextual = '말씀하신 흐름을 먼저 살펴보고 이어서 답할게요.';
    run.provider.generate.mockImplementation(async (request) => {
      run.requests.push(request);
      const text =
        run.requests.length === 1
          ? contextual
          : run.requests.length === 2
            ? verdict
            : scriptedOutputs()[2]!;
      return providerSuccess({
        text,
        toolCalls:
          run.requests.length === 1
            ? [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }]
            : [],
        finishReason: run.requests.length === 1 ? 'tool_calls' : 'complete',
      });
    });
    run.search.mockImplementation(async () => {
      expect(events.filter((event) => event.type === 'initial_response')).toHaveLength(
        verdict === 'ALLOW' ? 1 : 0,
      );
      return { status: 'available', publications: [publication] };
    });
    const result = await runMultiAgentWorkflow(
      {
        ...run.options,
        task: {
          ...run.options.task,
          initialToolResponse: (text) => text,
          reviewInitialToolResponse: true,
        },
      },
      { config: run.config, onTaskStreamEvent: (event) => events.push(event) },
    );
    expect(result.status).toBe('result');
    expect(run.requests).toHaveLength(3);
    expect(run.requests[1]?.tools).toBeUndefined();
    expect(run.requests[1]?.messages.at(-1)?.content).toBe(
      JSON.stringify({ request: run.options.request, candidate: contextual }),
    );
    expect(run.search).toHaveBeenCalledTimes(1);
  },
);

test('Stop during semantic review never displays a reply or dispatches the selected tool', async () => {
  const run = standardSearchFixture(true);
  const controller = new AbortController();
  const events: MultiAgentResponderStreamEvent[] = [];
  run.provider.generate.mockImplementation(async (request) => {
    run.requests.push(request);
    if (run.requests.length === 2) {
      controller.abort();
      return providerSuccess({ text: 'ALLOW', toolCalls: [], finishReason: 'complete' });
    }
    return providerSuccess({
      text: 'contextual candidate',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }],
    });
  });
  const result = await runMultiAgentWorkflow(
    {
      ...run.options,
      task: {
        ...run.options.task,
        initialToolResponse: (text) => text,
        reviewInitialToolResponse: true,
      },
    },
    {
      config: run.config,
      signal: controller.signal,
      onTaskStreamEvent: (event) => events.push(event),
    },
  );
  expect(result.status).toBe('cancelled');
  expect(run.search).not.toHaveBeenCalled();
  expect(events.filter((event) => event.type === 'initial_response')).toEqual([]);
});

test('denied semantic-review payload consent prevents review, preview and tool effects', async () => {
  const run = standardSearchFixture(true);
  const events: MultiAgentResponderStreamEvent[] = [];
  const authorize = jest.fn(async () => 'authorized' as 'authorized' | 'denied');
  authorize.mockResolvedValueOnce('authorized').mockResolvedValueOnce('denied');
  run.provider.generate.mockResolvedValue(
    providerSuccess({
      text: 'contextual candidate',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }],
    }),
  );
  const result = await runMultiAgentWorkflow(
    {
      ...run.options,
      execution: { ...run.options.execution, remoteProcessing: true },
      consent: { authorize },
      task: {
        ...run.options.task,
        initialToolResponse: (text) => text,
        reviewInitialToolResponse: true,
      },
    },
    { config: run.config, onTaskStreamEvent: (event) => events.push(event) },
  );
  expect(result.status).toBe('consent_required');
  expect(run.provider.generate).toHaveBeenCalledTimes(1);
  expect(run.search).not.toHaveBeenCalled();
  expect(events.filter((event) => event.type === 'initial_response')).toEqual([]);
});
