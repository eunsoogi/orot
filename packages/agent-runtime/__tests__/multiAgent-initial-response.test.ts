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
