import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

test.each([1, 2])('native searches respect an evidence capacity of %i', async (capacity) => {
  let searches = 0;
  const adapter = createEuropePmcEvidenceSearchTool({
    service: {
      search: async () => ({
        status: 'available',
        publications: [
          ++searches === 1
            ? publication
            : {
                ...publication,
                recordId: '67890',
                originalUrl: 'https://europepmc.org/article/MED/67890',
              },
        ],
      }),
    },
    consent: { authorize: async () => 'authorized' },
  });
  const limits: number[] = [];
  const tool = {
    ...adapter,
    search: jest.fn(async (input: Parameters<typeof adapter.search>[0]) => {
      limits.push(input.resultLimit);
      const batch = await adapter.search(input);
      if ('status' in batch) throw new Error('Unexpected consent outcome');
      return batch;
    }),
  };
  const base = makeProvider([]).provider;
  const requests: LanguageModelRequest[] = [];
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      return requests.length <= capacity
        ? providerSuccess({
            text: '',
            toolCalls: [
              {
                id: `call-${requests.length}`,
                name: tool.id,
                arguments: { query: 'synthetic query' },
              },
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
      budget: {
        ...options.execution.budget,
        maxEvidenceItems: capacity,
        maxToolCalls: 2,
        maxModelCalls: 4,
      },
    },
  });
  // A full external page remains conservatively truncated; capacity handling must not turn it into a budget failure.
  expect(result.status).toBe('needs_clarification');
  expect(limits).toEqual(capacity === 2 ? [2, 1] : [1]);
  if (capacity === 2) expect(requests[1]?.tools).toHaveLength(1);
  expect(requests[capacity]?.tools).toBeUndefined();
});
