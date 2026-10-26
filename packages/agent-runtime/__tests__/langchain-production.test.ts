import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { createProductionChatModel, invokeProductionRequest } from '../src/langchain/production';
import { NativeStreamingChatModel } from '../src/langchain/streaming';

const tool = {
  type: 'function' as const,
  function: {
    name: 'lookup',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
  },
};
const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};
const response = {
  text: '{"answer":"final"}',
  structuredOutput: { answer: 'final' },
  toolCalls: [],
  finishReason: 'complete' as const,
  usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
};

function fixture() {
  const generate = jest.fn(async (_request: LanguageModelRequest) => providerSuccess(response));
  const stream = jest.fn(async function* (_request: LanguageModelRequest) {
    yield providerSuccess({ type: 'text_snapshot' as const, text: 'draft' });
    yield providerSuccess({ type: 'completed' as const, response });
  });
  const provider: LanguageModelProvider = {
    id: 'synthetic',
    kind: 'language-model',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      requestControls: ['maxOutputTokens', 'temperature'],
    },
    generate,
    stream,
  };
  return { provider, generate, stream };
}

describe('production standard model composition', () => {
  it('keeps bound tools and buffered streaming through cloning with private callbacks and usage', async () => {
    const { provider, generate, stream } = fixture();
    const callbacks = {
      handleChatModelStart: jest.fn(),
      handleLLMNewToken: jest.fn(),
      handleLLMEnd: jest.fn(),
    };
    const bound = createProductionChatModel(provider).bindTools([tool]);
    expect(bound).toBeInstanceOf(NativeStreamingChatModel);
    const chunks = [];
    for await (const part of await bound.stream('Question', { callbacks: [callbacks] }))
      chunks.push(part);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(response.text);
    expect(chunks[0]?.usage_metadata).toEqual({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0].tools?.[0]?.name).toBe('lookup');
    expect(generate).not.toHaveBeenCalled();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('preserves binding for public structured output and validates once without callbacks', async () => {
    const { provider, generate, stream } = fixture();
    const bound = createProductionChatModel(provider).bindTools([tool]) as NativeStreamingChatModel;
    const callback = jest.fn();
    const result = await bound
      .withStructuredOutput(schema, { name: 'answer' })
      .invoke('Question', { callbacks: [{ handleChainStart: callback, handleLLMEnd: callback }] });
    expect(result).toEqual({ answer: 'final' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      tools: [{ name: 'lookup' }],
      responseFormat: { name: 'answer', schema },
    });
    expect(stream).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'preserves the approved workflow payload and native response with streaming=%s',
    async (streaming) => {
      const { provider, generate, stream } = fixture();
      const request: LanguageModelRequest = {
        messages: [{ role: 'user', content: 'Question' }],
        tools: [{ name: 'lookup', inputSchema: tool.function.parameters }],
        toolChoice: 'required',
        responseFormat: { name: 'answer', schema },
        maxOutputTokens: 20,
        temperature: 0,
      };
      expect(await invokeProductionRequest(provider, request, undefined, streaming)).toEqual(
        response,
      );
      const dispatch = streaming ? stream : generate;
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toEqual(request);
    },
  );

  it('retains an explicitly chosen append-only strategy after binding', async () => {
    const { provider, stream } = fixture();
    stream.mockImplementationOnce(async function* () {
      yield providerSuccess({ type: 'text_delta' as const, text: response.text }) as never;
      yield providerSuccess({ type: 'completed' as const, response });
    });
    const bound = new NativeStreamingChatModel(provider, 'append-only').bindTools([tool]);
    const chunks = [];
    for await (const part of await bound.stream('Question')) chunks.push(part.content);
    expect(chunks).toEqual([response.text, '']);
  });
});
