import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { createProductionChatModel, createStatefulTwoNodeGraph } from '../src';

const ChatState = Annotation.Root({
  request: Annotation<string>(),
  answer: Annotation<string>({ default: () => '' }),
});

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

  it('invokes the standard LangChain model directly from a LangGraph node', async () => {
    const response = {
      text: '무엇을 더 말씀드리면 좋을까요?',
      toolCalls: [],
      finishReason: 'complete' as const,
    };
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'test-provider',
      displayName: 'Test provider',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: jest.fn(async () => providerSuccess(response)),
    };
    const model = createProductionChatModel(provider);
    // Keep graph callers on LangChain's chat-model interface without a provider-shaped graph wrapper.
    const graph = new StateGraph(ChatState)
      .addNode('generate_answer', async ({ request }) => {
        const message = await model.invoke(request);
        if (typeof message.content !== 'string') throw new Error('Expected text model output.');
        return { answer: message.content };
      })
      .addEdge(START, 'generate_answer')
      .addEdge('generate_answer', END)
      .compile();

    const result = await graph.invoke({ request: 'Suggest one question.' });

    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(provider.generate.mock.calls[0]?.[0]).toEqual({
      messages: [{ role: 'user', content: 'Suggest one question.' }],
    });
    expect(result.answer).toBe(response.text);
  });
});
