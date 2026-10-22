import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

test.each([false, true])(
  'retains full facts once only for an opted-in rebuilt task: %s',
  async (compact) => {
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [publication],
    }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: async () => 'authorized' },
    });
    const base = makeProvider([]).provider;
    const requests: LanguageModelRequest[] = [];
    const call = {
      id: 'projection-call',
      name: tool.id,
      arguments: { query: 'synthetic concepts' },
    };
    const provider = {
      ...base,
      capabilities: { ...base.capabilities, structuredOutput: true, toolCalling: true },
      generate: async (request: LanguageModelRequest) => {
        requests.push(request);
        return providerSuccess(
          requests.length === 1
            ? { text: '', toolCalls: [call], finishReason: 'tool_calls' as const }
            : { text: scriptedOutputs()[2]!, toolCalls: [], finishReason: 'complete' as const },
        );
      },
    };
    const options = workflowOptions(provider, tool);
    const result = await runMultiAgentWorkflow({
      ...options,
      task: {
        ...options.task,
        ...(compact ? { nativeToolResultMode: 'evidence_references' as const } : {}),
      },
    });
    expect(result.status).toBe('result');
    expect(search).toHaveBeenCalledTimes(1);
    const revised = requests[1]!;
    expect(revised.messages).toContainEqual({ role: 'assistant', content: '', toolCalls: [call] });
    const response = revised.messages.find((message) => message.role === 'tool');
    expect(response).toMatchObject({ role: 'tool', toolCallId: call.id });
    const occurrences = JSON.stringify(revised.messages).split(publication.abstract!).length - 1;
    expect(occurrences).toBe(compact ? 1 : 2);
    if (compact) {
      expect(response).toMatchObject({
        result: {
          contentLocation: 'current_task_messages',
          evidenceIds: ['MED:12345'],
          coverage: [expect.objectContaining({ sourceKind: 'external_medical', returnedCount: 1 })],
          conflicts: [],
        },
      });
      expect(response && response.role === 'tool' && response.result).not.toHaveProperty('items');
    }
    if (result.status === 'result') expect(result.citations[0]?.evidenceId).toBe('MED:12345');
  },
);

test('keeps a completed empty search visible in a compact tool result', async () => {
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
      return providerSuccess(
        requests.length === 1
          ? {
              text: '',
              toolCalls: [{ id: 'empty', name: tool.id, arguments: { query: 'synthetic' } }],
              finishReason: 'tool_calls' as const,
            }
          : {
              text: JSON.stringify({
                kind: 'needs_clarification',
                message: 'No matching evidence.',
              }),
              toolCalls: [],
              finishReason: 'complete' as const,
            },
      );
    },
  };
  const options = workflowOptions(provider, tool);
  await runMultiAgentWorkflow({
    ...options,
    task: { ...options.task, nativeToolResultMode: 'evidence_references' },
  });
  expect(requests[1]?.messages.find((message) => message.role === 'tool')).toMatchObject({
    result: {
      evidenceIds: [],
      coverage: [expect.objectContaining({ returnedCount: 0 })],
      conflicts: [],
    },
  });
});
