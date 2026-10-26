import { AIMessageChunk } from '@langchain/core/messages';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  LanguageModelStreamEvent,
  ProviderResult,
} from '@orot/model-runtime';
import { NativeChatModelError } from '../src/langchain/chatModel';
import { NativeStreamingChatModel } from '../src/langchain/streaming';

function response(text: string, usage?: LanguageModelResponse['usage']): LanguageModelResponse {
  return { text, toolCalls: [], finishReason: 'complete', ...(usage ? { usage } : {}) };
}

function event(value: LanguageModelStreamEvent): ProviderResult<LanguageModelStreamEvent> {
  return { ok: true, value };
}

function fixture(
  events: readonly ProviderResult<LanguageModelStreamEvent>[],
  options: { streaming?: boolean; streamAvailable?: boolean; generatedText?: string } = {},
) {
  const generate = jest.fn(async () => ({
    ok: true as const,
    value: response(options.generatedText ?? 'Generated'),
  }));
  const stream = jest.fn((_request: LanguageModelRequest, _execution?: { signal?: AbortSignal }) =>
    (async function* () {
      for (const item of events) yield item;
    })(),
  );
  const provider: LanguageModelProvider = {
    id: 'synthetic-provider',
    kind: 'language-model',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: options.streaming ?? true,
      structuredOutput: false,
      toolCalling: false,
      requestControls: ['maxOutputTokens', 'temperature'],
    },
    generate,
    ...(options.streamAvailable === false ? {} : { stream }),
  };
  return { provider, generate, stream };
}

async function collect(stream: AsyncIterable<AIMessageChunk>): Promise<AIMessageChunk[]> {
  const chunks: AIMessageChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function aggregate(chunks: readonly AIMessageChunk[]): AIMessageChunk {
  return chunks.slice(1).reduce((message, chunk) => message.concat(chunk), chunks[0]!);
}

describe('native chat streaming', () => {
  it('converts append-only deltas in order and preserves terminal usage without callbacks', async () => {
    const { provider, generate, stream } = fixture([
      event({ type: 'text_delta', text: 'Hello' }),
      event({ type: 'text_delta', text: ' world' }),
      event({
        type: 'completed',
        response: response('Hello world', { inputTokens: 3, outputTokens: 2, totalTokens: 5 }),
      }),
    ]);
    const callbacks = {
      handleChatModelStart: jest.fn(),
      handleLLMNewToken: jest.fn(),
      handleLLMEnd: jest.fn(),
      handleLLMError: jest.fn(),
    };

    const chunks = await collect(
      await new NativeStreamingChatModel(provider, 'append-only').stream('Question', {
        maxOutputTokens: 12,
        temperature: 0,
        callbacks: [callbacks],
      }),
    );
    const result = aggregate(chunks);

    expect(chunks.map((chunk) => chunk.content)).toEqual(['Hello', ' world', '']);
    expect(result.content).toBe('Hello world');
    expect(result.response_metadata.finish_reason).toBe('complete');
    expect(result.usage_metadata).toMatchObject({
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual({
      messages: [{ role: 'user', content: 'Question' }],
      maxOutputTokens: 12,
      temperature: 0,
    });
    expect(stream.mock.calls[0][1]).toEqual({ signal: undefined });
    expect(generate).not.toHaveBeenCalled();
    expect(callbacks.handleChatModelStart).not.toHaveBeenCalled();
    expect(callbacks.handleLLMNewToken).not.toHaveBeenCalled();
    expect(callbacks.handleLLMEnd).not.toHaveBeenCalled();
    expect(callbacks.handleLLMError).not.toHaveBeenCalled();
  });

  it('buffers revised snapshots and reconciles the terminal response before emitting a chunk', async () => {
    const { provider, generate, stream } = fixture([
      event({ type: 'text_delta', text: 'draft' }),
      event({ type: 'text_snapshot', text: 'final' }),
      event({ type: 'completed', response: response('final answer') }),
    ]);

    const chunks = await collect(
      await new NativeStreamingChatModel(provider, 'buffered').stream('Question'),
    );

    expect(chunks).toHaveLength(1);
    expect(aggregate(chunks).content).toBe('final answer');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not invent a delta when an append-only provider contradicts its terminal text', async () => {
    const { provider } = fixture([
      event({ type: 'text_delta', text: 'draft' }),
      event({ type: 'completed', response: response('final') }),
    ]);

    await expect(
      collect(await new NativeStreamingChatModel(provider, 'append-only').stream('Question')),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  it('uses the existing single-generation fallback when streaming is unavailable', async () => {
    const { provider, generate, stream } = fixture([], {
      streaming: false,
      generatedText: 'Answer',
    });
    const chunks = await collect(
      await new NativeStreamingChatModel(provider, 'append-only').stream('Question'),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('Answer');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
  });

  it('maps provider failures without exposing diagnostics', async () => {
    const { provider } = fixture([
      {
        ok: false,
        error: {
          code: 'provider_unavailable',
          message: 'private provider detail',
          retryable: true,
        },
      },
    ]);

    const error = await collect(
      await new NativeStreamingChatModel(provider, 'append-only').stream('Question'),
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(NativeChatModelError);
    expect(error).toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect((error as Error).message).not.toContain('private provider detail');
  });

  it('passes abort to the provider and closes its iterator after cancellation', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    let providerReads = 0;
    let cleanedUp = false;
    const source = async function* () {
      try {
        providerReads += 1;
        yield event({ type: 'text_delta', text: 'partial' });
        providerReads += 1;
        await new Promise<void>((resolve) => {
          if (receivedSignal?.aborted) resolve();
          else receivedSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw Object.assign(new Error('private cancellation detail'), { name: 'AbortError' });
      } finally {
        cleanedUp = true;
      }
    };
    const { provider } = fixture([]);
    provider.stream = jest.fn((_request, execution) => {
      receivedSignal = execution?.signal;
      return source();
    });
    const iterable = await new NativeStreamingChatModel(provider, 'append-only').stream(
      'Question',
      { signal: controller.signal },
    );
    const iterator = iterable[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedSignal).toBe(controller.signal);
    expect(providerReads).toBe(1);
    expect(cleanedUp).toBe(true);
  });

  it('closes the provider iterator when the consumer stops after a chunk', async () => {
    let cleanedUp = false;
    const source = async function* () {
      try {
        yield event({ type: 'text_delta', text: 'partial' });
        await new Promise<void>(() => {});
      } finally {
        cleanedUp = true;
      }
    };
    const { provider } = fixture([]);
    provider.stream = jest.fn(() => source());
    const iterable = await new NativeStreamingChatModel(provider, 'append-only').stream('Question');
    const iterator = iterable[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();
    expect(cleanedUp).toBe(true);
  });
});
