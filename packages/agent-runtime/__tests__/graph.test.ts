import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { createLanguageModelProviderGraph, createStatefulTwoNodeGraph } from '../src';

describe('stateful LangGraph', () => {
  it('invokes both nodes once and exposes each completed state on the value stream', async () => {
    const graph = createStatefulTwoNodeGraph();
    const input = { value: 3 };
    const expectedNodes = ['increment', 'double'];

    await expect(graph.invoke(input)).resolves.toMatchObject({
      value: 8,
      nodeRuns: expectedNodes,
    });

    const states = [];
    for await (const state of await graph.stream(input, { streamMode: 'values' })) {
      states.push(state);
    }

    expect(states).toHaveLength(3);
    expect(states[0]).toMatchObject({ value: 3, nodeRuns: [] });
    expect(states[1]).toMatchObject({ value: 4, nodeRuns: ['increment'] });
    expect(states[2]).toMatchObject({ value: 8, nodeRuns: expectedNodes });
  });

  it('invokes a normalized language-model provider from a LangGraph node', async () => {
    const request = { messages: [{ role: 'user' as const, content: 'Suggest one question.' }] };
    const response = { text: '무엇을 더 말씀드리면 좋을까요?', toolCalls: [], finishReason: 'complete' as const };
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'test-provider',
      displayName: 'Test provider',
      capabilities: { inputTypes: ['text'], streaming: false, structuredOutput: false, toolCalling: false },
      generate: jest.fn(async () => providerSuccess(response)),
    };
    const graph = createLanguageModelProviderGraph(provider);

    const result = await graph.invoke({ request });

    expect(provider.generate).toHaveBeenCalledWith(request);
    expect(result.result).toEqual(providerSuccess(response));
  });
});
