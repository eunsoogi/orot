import { providerSuccess } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import { validBudget } from '../src/multiAgent/budgetValidation';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

test('an explicitly expanded budget allows four tool calls before the answer', async () => {
  const search = jest
    .fn()
    .mockResolvedValueOnce({ status: 'empty' })
    .mockResolvedValueOnce({ status: 'empty' })
    .mockResolvedValueOnce({ status: 'empty' })
    .mockResolvedValueOnce({ status: 'available', publications: [publication] });
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  let calls = 0;
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async () => {
      calls += 1;
      return calls <= 4
        ? providerSuccess({
            text: '',
            toolCalls: [
              { id: `call-${calls}`, name: tool.id, arguments: { query: `query ${calls}` } },
            ],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: scriptedOutputs()[2]!,
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    },
  };
  const options = workflowOptions(provider, tool);
  const result = await runMultiAgentWorkflow({
    ...options,
    execution: {
      ...options.execution,
      budget: { ...options.execution.budget, maxModelCalls: 5, maxToolCalls: 4 },
    },
  });
  expect(result.status).toBe('result');
  expect(search).toHaveBeenCalledTimes(4);
  expect(calls).toBe(5);
});

test('expanded budgets remain bounded', () => {
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'empty' }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(makeProvider([]).provider, tool);
  const budget = options.execution.budget;
  expect(
    validBudget({
      ...options,
      execution: { ...options.execution, budget: { ...budget, maxModelCalls: 8, maxToolCalls: 4 } },
    }),
  ).toBe(true);
  expect(
    validBudget({
      ...options,
      execution: { ...options.execution, budget: { ...budget, maxModelCalls: 9 } },
    }),
  ).toBe(false);
  expect(
    validBudget({
      ...options,
      execution: { ...options.execution, budget: { ...budget, maxToolCalls: 5 } },
    }),
  ).toBe(false);
});
