import { describe, expect, it } from '@jest/globals';
import type {
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import {
  APPLE_PROVIDER_CAPABILITIES,
  AppleFoundationModelsProvider,
  type AppleAvailabilityStatus,
  type AppleFoundationModelsNativeBridge,
  type AppleNativeStreamPacket,
} from '../src';

const request: LanguageModelRequest = {
  messages: [{ role: 'user', content: '질문을 만들 때 source-42를 유지해 주세요.' }],
  responseFormat: {
    name: 'visit_questions',
    schema: {
      type: 'object',
      properties: { sourceIds: { type: 'array', items: { type: 'string' } } },
      required: ['sourceIds'],
    },
  },
};

const response: LanguageModelResponse = {
  text: '{"sourceIds":["source-42"]}',
  structuredOutput: { sourceIds: ['source-42'] },
  toolCalls: [],
  finishReason: 'complete',
};

class FakeNativeBridge implements AppleFoundationModelsNativeBridge {
  availability: AppleAvailabilityStatus = 'available';
  generateCount = 0;
  readonly cancelled: string[] = [];
  readonly generatedRequestIds: string[] = [];
  generated: LanguageModelResponse = response;
  generateWait?: Promise<LanguageModelResponse>;
  onGenerate?: (requestId: string) => void;
  packets: AppleNativeStreamPacket[] = [
    { type: 'snapshot', text: '안' },
    { type: 'snapshot', text: '안녕' },
    {
      type: 'completed',
      response: { text: '안녕', toolCalls: [], finishReason: 'complete' },
    },
  ];

  async getAvailability() {
    return { status: this.availability } as const;
  }

  async generate(_request: Parameters<AppleFoundationModelsNativeBridge['generate']>[0], requestId: string) {
    this.generateCount += 1;
    this.generatedRequestIds.push(requestId);
    this.onGenerate?.(requestId);
    return this.generateWait ?? this.generated;
  }

  async *stream() {
    for (const packet of this.packets) yield packet;
  }

  cancel(requestId: string) {
    this.cancelled.push(requestId);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('AppleFoundationModelsProvider', () => {
  it('advertises only capabilities implemented by its native boundary', () => {
    const native = new FakeNativeBridge();
    const provider = new AppleFoundationModelsProvider(native);

    expect(provider.capabilities).toEqual(APPLE_PROVIDER_CAPABILITIES);
    expect(provider.capabilities).toMatchObject({
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: true,
      toolCalling: true,
    });
  });

  it('preserves structured output and its source ids from the native result', async () => {
    const provider = new AppleFoundationModelsProvider(new FakeNativeBridge());

    await expect(provider.generate(request)).resolves.toEqual({ ok: true, value: response });
  });

  it('preserves normalized tool calls without executing them', async () => {
    const native = new FakeNativeBridge();
    const toolResponse: LanguageModelResponse = {
      text: '',
      toolCalls: [{ id: 'request-tool-0', name: 'lookup_source', arguments: { sourceId: 'source-42' } }],
      finishReason: 'tool_calls',
    };
    native.generated = toolResponse;
    const provider = new AppleFoundationModelsProvider(native);
    const toolRequest: LanguageModelRequest = {
      messages: [{ role: 'user', content: 'Use source-42 to answer.' }],
      tools: [{
        name: 'lookup_source',
        inputSchema: {
          type: 'object',
          properties: { sourceId: { type: 'string' } },
          required: ['sourceId'],
          additionalProperties: false,
        },
      }],
    };

    await expect(provider.generate(toolRequest)).resolves.toEqual({ ok: true, value: toolResponse });
    expect(native.generateCount).toBe(1);
  });

  it('reports unavailable states without invoking generation or falling back', async () => {
    const unavailable: AppleAvailabilityStatus[] = [
      'disabled', 'modelNotReady', 'unsupportedDevice', 'unsupportedLanguage',
    ];
    for (const status of unavailable) {
      const native = new FakeNativeBridge();
      native.availability = status;
      const provider = new AppleFoundationModelsProvider(native);
      const result = await provider.generate(request);

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'provider_unavailable', retryable: status === 'modelNotReady' },
      });
      expect(native.generateCount).toBe(0);
    }
  });

  it('rejects non-text content before crossing the native boundary', async () => {
    const native = new FakeNativeBridge();
    const provider = new AppleFoundationModelsProvider(native);
    const imageRequest = {
      messages: [{
        role: 'user' as const,
        content: [{ type: 'image' as const, data: new Uint8Array(), mediaType: 'image/png' }],
      }],
    };

    await expect(provider.generate(imageRequest)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_input' },
    });
    expect(native.generateCount).toBe(0);
  });

  it('cancels the native request and ignores a late result when aborted', async () => {
    const native = new FakeNativeBridge();
    const pending = deferred<LanguageModelResponse>();
    const started = deferred<void>();
    native.generateWait = pending.promise;
    native.onGenerate = () => started.resolve();
    const provider = new AppleFoundationModelsProvider(native);
    const controller = new AbortController();
    const call = provider.generate(request, { signal: controller.signal });
    await started.promise;
    controller.abort();

    await expect(call).rejects.toHaveProperty('name', 'AbortError');
    expect(native.cancelled).toEqual(native.generatedRequestIds);
    expect(native.generateCount).toBe(1);
    pending.resolve(response);
  });

  it('does not start native work when aborted during the availability check', async () => {
    const native = new FakeNativeBridge();
    const pendingAvailability = deferred<{ status: 'available' }>();
    native.getAvailability = () => pendingAvailability.promise;
    const provider = new AppleFoundationModelsProvider(native);
    const controller = new AbortController();
    const call = provider.generate(request, { signal: controller.signal });

    controller.abort();
    pendingAvailability.resolve({ status: 'available' });

    await expect(call).rejects.toHaveProperty('name', 'AbortError');
    expect(native.generateCount).toBe(0);
    expect(native.cancelled).toHaveLength(0);
  });

  it('converts append-only snapshots into deltas and completes with the response', async () => {
    const provider = new AppleFoundationModelsProvider(new FakeNativeBridge());
    const events = [];

    for await (const event of provider.stream({ messages: [{ role: 'user', content: '인사해 주세요.' }] })) {
      events.push(event);
    }

    expect(events).toMatchObject([
      { ok: true, value: { type: 'text_delta', text: '안' } },
      { ok: true, value: { type: 'text_delta', text: '녕' } },
      { ok: true, value: { type: 'completed', response: { text: '안녕' } } },
    ]);
  });

  it('fails explicitly if a stream snapshot rewrites prior text', async () => {
    const native = new FakeNativeBridge();
    native.packets = [
      { type: 'snapshot', text: '안녕하세요' },
      { type: 'snapshot', text: '안녕' },
    ];
    const provider = new AppleFoundationModelsProvider(native);
    const events = [];

    for await (const event of provider.stream({ messages: [{ role: 'user', content: '인사해 주세요.' }] })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { code: 'internal_error', message: expect.stringContaining('rewrote') },
    });
    expect(native.cancelled).toHaveLength(1);
  });

  it('cancels the native stream when the consumer closes its iterator', async () => {
    const native = new FakeNativeBridge();
    const provider = new AppleFoundationModelsProvider(native);
    const stream = provider.stream({ messages: [{ role: 'user', content: '인사해 주세요.' }] });
    const iterator = stream[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(native.cancelled).toHaveLength(1);
  });
});
