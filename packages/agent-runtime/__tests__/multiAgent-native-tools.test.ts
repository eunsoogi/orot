import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import { guidedSchema } from '../src/multiAgent/guidedSchema';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

test('can refine an empty search with a second model-selected tool call', async () => {
  const search = jest
    .fn()
    .mockResolvedValueOnce({ status: 'available', publications: [] })
    .mockResolvedValueOnce({ status: 'available', publications: [publication] });
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  const requests: LanguageModelRequest[] = [];
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      return requests.length <= 2
        ? providerSuccess({
            text: '',
            toolCalls: [
              {
                id: `call-${requests.length}`,
                name: tool.id,
                arguments: { query: `query ${requests.length}` },
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
    execution: { ...options.execution, budget: { ...options.execution.budget, maxToolCalls: 2 } },
  });
  expect(result.status).toBe('result');
  expect(search).toHaveBeenCalledTimes(2);
  expect(requests).toHaveLength(3);
  expect(requests[1]?.tools?.map((value) => value.name)).toContain(tool.id);
  expect(requests[2]?.messages.filter((value) => value.role === 'tool')).toHaveLength(2);
});

test('executes the model tool call and returns its matching tool result before answering', async () => {
  const requests: LanguageModelRequest[] = [];
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  const call = { id: 'call-1', name: tool.id, arguments: { query: 'model chosen query' } };
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, structuredOutput: true, toolCalling: true },
    generate: jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      if (requests.length === 1) {
        expect(search).not.toHaveBeenCalled();
        return providerSuccess({
          text: '',
          toolCalls: [call],
          finishReason: 'tool_calls' as const,
        });
      }
      return providerSuccess({
        text: scriptedOutputs()[2]!,
        toolCalls: [],
        finishReason: 'complete' as const,
      });
    }),
  };
  const result = await runMultiAgentWorkflow(workflowOptions(provider, tool));
  expect(result.status).toBe('result');
  expect(requests).toHaveLength(2);
  expect(requests[0]?.responseFormat).toBeDefined();
  expect(JSON.stringify(requests[0]?.responseFormat?.schema)).not.toContain('request_evidence');
  expect(requests[0]?.tools).toContainEqual({
    name: tool.id,
    description: tool.description,
    inputSchema: guidedSchema(tool.inputSchema),
  });
  expect(search).toHaveBeenCalledTimes(1);
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      { role: 'assistant', content: '', toolCalls: [call] },
      expect.objectContaining({ role: 'tool', toolCallId: call.id }),
    ]),
  );
});

test('does not substitute a JSON research plan for a native provider tool call', async () => {
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: jest.fn() },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  const generate = jest.fn(async () =>
    providerSuccess({
      text: scriptedOutputs()[0]!,
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const provider = { ...base, capabilities: { ...base.capabilities, toolCalling: true }, generate };
  const result = await runMultiAgentWorkflow(workflowOptions(provider, tool));
  expect(result.status).toBe('invalid_output');
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each(['unknown', 'invalid_arguments', 'duplicate_calls', 'no_budget'])(
  'rejects %s before executing any tool',
  async (failure) => {
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: async () => 'authorized' },
    });
    const base = makeProvider([]).provider;
    const call = {
      id: 'call-1',
      name: failure === 'unknown' ? 'unregistered-tool' : tool.id,
      arguments: failure === 'invalid_arguments' ? {} : { query: 'model chosen query' },
    };
    const provider = {
      ...base,
      capabilities: { ...base.capabilities, toolCalling: true },
      generate: async () =>
        providerSuccess({
          text: '',
          toolCalls: failure === 'duplicate_calls' ? [call, call] : [call],
          finishReason: 'tool_calls' as const,
        }),
    };
    const options = workflowOptions(provider, tool);
    const result = await runMultiAgentWorkflow({
      ...options,
      execution: {
        ...options.execution,
        budget: {
          ...options.execution.budget,
          ...(failure === 'no_budget' ? { maxModelCalls: 1 } : {}),
        },
      },
    });
    expect(result.status).toBe(failure === 'no_budget' ? 'budget_exceeded' : 'invalid_output');
    expect(search).not.toHaveBeenCalled();
  },
);

test('returns an empty tool result to the model without turning it into evidence', async () => {
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const base = makeProvider([]).provider;
  const requests: LanguageModelRequest[] = [];
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: async (request: LanguageModelRequest) => {
      requests.push(request);
      return requests.length === 1
        ? providerSuccess({
            text: '',
            toolCalls: [{ id: 'empty-1', name: tool.id, arguments: { query: 'no matching data' } }],
            finishReason: 'tool_calls' as const,
          })
        : providerSuccess({
            text: scriptedOutputs()[2]!,
            toolCalls: [],
            finishReason: 'complete' as const,
          });
    },
  };
  const result = await runMultiAgentWorkflow(workflowOptions(provider, tool));
  expect(requests).toHaveLength(2);
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'empty-1',
        result: expect.objectContaining({ items: [] }),
      }),
    ]),
  );
  expect(result.status).not.toBe('result');
});
