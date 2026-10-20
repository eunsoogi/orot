import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { runMultiAgentWorkflow, type EvidenceSearchTool } from '../src';
import { partitionFixture } from './partitioned-result-fixtures';

test.each([3, 4])(
  'model-selected private/public tools and grouped finals obey the shared %i-call budget',
  async (maxModelCalls) => {
    const f = partitionFixture();
    const tools: EvidenceSearchTool[] = f.records.map((record, index) => ({
      id: 'source-tool-' + index,
      sourceKind: record.sourceKind,
      execution: index ? 'external_read_only' : 'local_read_only',
      description: 'Read this synthetic source.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      parseInput: () => ({ query: 'synthetic concept' }),
      search: jest.fn(async () => ({
        items: [record],
        coverage: [f.options.initialEvidence.coverage[index]!],
        conflicts: [],
      })),
    }));
    const requests: LanguageModelRequest[] = [];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      if (requests.length <= 2)
        return providerSuccess({
          text: '',
          toolCalls: [
            {
              id: 'chosen-' + requests.length,
              name: tools[requests.length - 1]!.id,
              arguments: { query: 'synthetic concept' },
            },
          ],
          finishReason: 'tool_calls' as const,
        });
      return f.options.provider.generate(request);
    });
    const result = await runMultiAgentWorkflow({
      ...f.options,
      initialEvidence: { items: [], coverage: [], conflicts: [] },
      execution: {
        ...f.options.execution,
        budget: { ...f.options.execution.budget, maxModelCalls },
      },
      provider: {
        ...f.options.provider,
        capabilities: { ...f.options.provider.capabilities, toolCalling: true },
        generate,
      },
      task: {
        ...f.options.task,
        nativeToolResultMode: 'evidence_references',
        requiredToolEvidenceKinds: ['personal_record', 'external_medical'],
      },
      tools,
    });
    expect(tools[0]!.search).toHaveBeenCalledTimes(1);
    expect(tools[1]!.search).toHaveBeenCalledTimes(1);
    expect(requests[0]!.toolChoice).toBe('required');
    expect(requests[0]!.tools!.map((tool) => tool.name)).toEqual(['source-tool-0']);
    expect(requests[1]!.tools!.map((tool) => tool.name)).toEqual(['source-tool-1']);
    expect(result.status).toBe(maxModelCalls === 4 ? 'result' : 'budget_exceeded');
    expect(requests).toHaveLength(maxModelCalls === 4 ? 4 : 2);
    expect(result.checkpoint.modelCalls).toBe(maxModelCalls);
    expect(result.checkpoint.toolCalls).toBe(2);
    expect(f.requests).toHaveLength(maxModelCalls === 4 ? 2 : 0);
    for (const request of f.requests) {
      expect(request.tools).toBeUndefined();
      expect(request.messages.some((message) => message.role === 'tool')).toBe(false);
    }
  },
);
