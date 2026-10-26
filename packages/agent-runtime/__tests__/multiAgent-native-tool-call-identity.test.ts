import { providerSuccess } from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '../src';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';

/** Regression coverage for native call identity reuse across graph turns. */
test('rejects a repeated native call ID before executing the tool again', async () => {
  const run = standardSearchFixture(true);
  run.provider.generate.mockImplementation(async (request) => {
    run.requests.push(request);
    return providerSuccess({
      text: '',
      toolCalls: [
        {
          id: 'standard-search-call',
          name: run.tool.id,
          arguments: { query: 'synthetic external literature query' },
        },
      ],
      finishReason: 'tool_calls',
    });
  });

  const result = await runMultiAgentWorkflow(
    {
      ...run.options,
      execution: {
        ...run.options.execution,
        budget: { ...run.options.execution.budget, maxToolCalls: 2 },
      },
    },
    { config: run.config },
  );

  expect(result.status).toBe('invalid_output');
  expect(run.requests).toHaveLength(2);
  expect(run.search).toHaveBeenCalledTimes(1);
});
