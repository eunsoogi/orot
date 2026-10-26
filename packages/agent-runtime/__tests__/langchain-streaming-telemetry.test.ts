import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelResponse,
  LanguageModelStreamEvent,
  ProviderResult,
} from '@orot/model-runtime';
import { NativeStreamingChatModel } from '../src/langchain/streaming';
import { OROT_TELEMETRY_EVENT_NAME } from '../src/langchain/telemetryCallbacks';

function response(text: string): LanguageModelResponse {
  return { text, toolCalls: [], finishReason: 'complete' };
}

function event(value: LanguageModelStreamEvent): ProviderResult<LanguageModelStreamEvent> {
  return { ok: true, value };
}

function fixture(stream: LanguageModelProvider['stream']) {
  const generate = jest.fn();
  const provider: LanguageModelProvider = {
    id: 'synthetic-provider',
    kind: 'language-model',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
    stream,
  };
  return { provider, generate };
}

async function collect(stream: AsyncIterable<{ content: unknown }>) {
  const chunks: unknown[] = [];
  for await (const part of stream) chunks.push(part.content);
  return chunks;
}

function telemetryPayload(events: unknown[]) {
  return (events[0] as { data: Record<string, unknown> }).data;
}

describe('buffered stream telemetry callbacks', () => {
  it('emits one allowlisted event after the buffered provider stream completes', async () => {
    const providerStream = jest.fn((_request: LanguageModelRequest) =>
      (async function* () {
        yield event({ type: 'text_snapshot', text: 'SENTINEL_DRAFT' });
        yield event({
          type: 'completed',
          response: response('SENTINEL_FINAL'),
        });
      })(),
    );
    const { provider, generate } = fixture(providerStream);
    const events: unknown[] = [];
    const callback = {
      handleCustomEvent: (name: string, data: unknown, runId: string) => {
        events.push({ name, data, runId });
      },
      handleLLMNewToken: jest.fn(),
    };

    const chunks = await collect(
      await new NativeStreamingChatModel(provider, 'buffered').stream('SENTINEL_PROMPT', {
        externalTelemetryEnabled: true,
        callbacks: [callback],
        tags: ['SENTINEL_TAG'],
        metadata: { evidence: 'SENTINEL_METADATA' },
      }),
    );

    expect(chunks).toEqual(['SENTINEL_FINAL']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: OROT_TELEMETRY_EVENT_NAME });
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.stream',
      outcome: 'success',
    });
    expect(Object.keys(telemetryPayload(events)).sort()).toEqual([
      'durationMs',
      'operation',
      'outcome',
    ]);
    const forwarded = JSON.stringify(events);
    for (const sentinel of [
      'SENTINEL_PROMPT',
      'SENTINEL_DRAFT',
      'SENTINEL_FINAL',
      'SENTINEL_TAG',
      'SENTINEL_METADATA',
    ])
      expect(forwarded).not.toContain(sentinel);
    expect(providerStream).toHaveBeenCalledTimes(1);
    expect(providerStream.mock.calls[0]![0]).toEqual({
      messages: [{ role: 'user', content: 'SENTINEL_PROMPT' }],
    });
    expect(generate).not.toHaveBeenCalled();
    expect(callback.handleLLMNewToken).not.toHaveBeenCalled();
  });

  it('keeps buffered stream callbacks private by default', async () => {
    const providerStream = jest.fn(() =>
      (async function* () {
        yield event({ type: 'completed', response: response('Answer') });
      })(),
    );
    const { provider } = fixture(providerStream);
    const events: unknown[] = [];

    await collect(
      await new NativeStreamingChatModel(provider, 'buffered').stream('Question', {
        callbacks: [{ handleCustomEvent: (_name: string, data: unknown) => events.push(data) }],
      }),
    );

    expect(events).toEqual([]);
    expect(providerStream).toHaveBeenCalledTimes(1);
  });

  it('preserves a redacted provider failure when its telemetry callback throws', async () => {
    const providerStream = jest.fn(() =>
      (async function* () {
        yield {
          ok: false,
          error: {
            code: 'provider_unavailable',
            message: 'SENTINEL_STREAM_DIAGNOSTIC',
            retryable: true,
          },
        } satisfies ProviderResult<LanguageModelStreamEvent>;
      })(),
    );
    const { provider } = fixture(providerStream);
    const events: unknown[] = [];
    const callback = {
      handleCustomEvent: (name: string, data: unknown, runId: string) => {
        events.push({ name, data, runId });
        throw new Error('SENTINEL_STREAM_CALLBACK_FAILURE');
      },
    };
    const stream = await new NativeStreamingChatModel(provider, 'buffered').stream(
      'SENTINEL_STREAM_PROMPT',
      {
        externalTelemetryEnabled: true,
        callbacks: [callback],
      },
    );

    await expect(collect(stream)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });

    expect(events).toHaveLength(1);
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.stream',
      outcome: 'error',
      errorCode: 'provider_unavailable',
    });
    expect(JSON.stringify(events)).not.toContain('SENTINEL_STREAM_DIAGNOSTIC');
    expect(JSON.stringify(events)).not.toContain('SENTINEL_STREAM_CALLBACK_FAILURE');
    expect(providerStream).toHaveBeenCalledTimes(1);
  });

  it('preserves abort behavior and reports one cancellation event', async () => {
    const controller = new AbortController();
    let dispatched!: () => void;
    const dispatchedPromise = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    const providerStream = jest.fn(() =>
      (async function* () {
        dispatched();
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) resolve();
          else controller.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw Object.assign(new Error('SENTINEL_ABORT_DIAGNOSTIC'), { name: 'AbortError' });
      })(),
    );
    const { provider } = fixture(providerStream);
    const events: unknown[] = [];
    const iterable = await new NativeStreamingChatModel(provider, 'buffered').stream('Question', {
      signal: controller.signal,
      externalTelemetryEnabled: true,
      callbacks: [
        {
          handleCustomEvent: (name: string, data: unknown, runId: string) => {
            events.push({ name, data, runId });
          },
        },
      ],
    });
    const iterator = iterable[Symbol.asyncIterator]();
    const pending = iterator.next();
    await dispatchedPromise;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    expect(events).toHaveLength(1);
    expect(telemetryPayload(events)).toMatchObject({
      operation: 'language-model.stream',
      outcome: 'cancelled',
    });
    expect(JSON.stringify(events)).not.toContain('SENTINEL_ABORT_DIAGNOSTIC');
    expect(providerStream).toHaveBeenCalledTimes(1);
  });
});
