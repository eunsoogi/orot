import { describe, expect, it } from '@jest/globals';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { createChatGPTPlanProvider, listChatGPTPlanModels } from '../src';
import { baseRequest, FakeBridge } from './providerTestSupport';

describe('ChatGPT plan model adapter', () => {
  it('normalizes account-specific model descriptors without losing display order', async () => {
    const bridge = new FakeBridge();
    bridge.models = [
      { slug: 'gpt-first', displayName: 'First model' },
      { slug: 'gpt-second', displayName: 'Second model' },
    ];

    await expect(listChatGPTPlanModels(bridge, 'issued-client')).resolves.toEqual({
      ok: true,
      value: [
        {
          id: 'chatgpt-plan:issued-client:gpt-first',
          slug: 'gpt-first',
          displayName: 'First model',
        },
        {
          id: 'chatgpt-plan:issued-client:gpt-second',
          slug: 'gpt-second',
          displayName: 'Second model',
        },
      ],
    });
    expect(bridge.listedAccount).toBe('issued-client');
  });

  it('keeps usage diagnostics from a model catalog HTTP failure', async () => {
    const bridge = new FakeBridge();
    bridge.listFailure = Object.assign(new Error('Catalog request failed.'), {
      code: 'CHATGPT_PROVIDER_ERROR',
      userInfo: {
        kind: 'usage_limit',
        httpStatusCode: 429,
        code: 'subscription_sharing_usage_limit_exceeded',
      },
    });

    await expect(listChatGPTPlanModels(bridge, 'issued-client')).resolves.toEqual({
      ok: false,
      error: {
        code: 'rate_limited',
        message: 'The ChatGPT plan usage limit was reached.',
        retryable: false,
      },
    });
  });

  it('implements LanguageModelProvider and completes only at the terminal event', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({ requestId: requestID, type: 'text_delta', text: 'Hello' });
      target.emit({ requestId: requestID, type: 'completed', text: 'Hello' });
    });
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'issued-client',
      model: { slug: 'gpt-test', displayName: 'Test model' },
      requestIDFactory: () => 'request-1',
    });

    expect(provider.capabilities).toEqual({
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    });
    await expect(provider.generate(baseRequest)).resolves.toEqual({
      ok: true,
      value: { text: 'Hello', toolCalls: [], finishReason: 'complete' },
    });
    expect(bridge.started).toHaveLength(1);
    expect(bridge.started[0]?.request).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Say hello.' },
      ],
    });
  });

  it('surfaces a failed usage terminal after preserving earlier deltas', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({ requestId: requestID, type: 'text_delta', text: 'Partial' });
      target.emit({
        requestId: requestID,
        type: 'failed',
        error: { code: 'subscription_sharing_usage_limit_exceeded', httpStatusCode: 429 },
      });
    });
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'issued-client',
      model: { slug: 'gpt-test', displayName: 'Test model' },
      requestIDFactory: () => 'request-2',
    });

    const results = [];
    for await (const result of provider.stream!(baseRequest)) results.push(result);
    expect(results).toEqual([
      { ok: true, value: { type: 'text_delta', text: 'Partial' } },
      {
        ok: false,
        error: {
          code: 'rate_limited',
          message: 'The ChatGPT plan usage limit was reached.',
          retryable: false,
        },
      },
    ]);
  });

  it('rejects unsupported request fields before reaching the bridge', async () => {
    const bridge = new FakeBridge();
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'issued-client',
      model: { slug: 'gpt-test', displayName: 'Test model' },
      requestIDFactory: () => 'request-3',
    });
    const requests: LanguageModelRequest[] = [
      { ...baseRequest, temperature: 0.2 },
      { ...baseRequest, maxOutputTokens: 20 },
      { ...baseRequest, responseFormat: { name: 'json', schema: {} } },
      { ...baseRequest, tools: [{ name: 'lookup', inputSchema: {} }] },
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', data: new Uint8Array(), mediaType: 'image/png' }],
          },
        ],
      },
    ];

    for (const request of requests) {
      const result = await provider.generate(request);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok)
        expect(['unsupported_capability', 'unsupported_input']).toContain(result.error.code);
    }
    expect(bridge.started).toHaveLength(0);
  });

  it('cancels native work when the consumer returns while waiting for an event', async () => {
    let releaseStart!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const bridge = new FakeBridge(async () => {
      signalStarted();
      await new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
    });
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'issued-client',
      model: { slug: 'gpt-test', displayName: 'Test model' },
      requestIDFactory: () => 'request-cancel',
    });
    const iterator = provider.stream!(baseRequest)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await started;

    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined });
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(bridge.cancelled).toEqual(['request-cancel']);
    releaseStart();
    await Promise.resolve();
    expect(bridge.cancelled).toEqual(['request-cancel']);
  });

  it('isolates simultaneous streams from provider instances sharing a bridge', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const releases: (() => void)[] = [];
      const bridge = new FakeBridge(
        async () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      );
      const options = {
        bridge,
        issuedClientID: 'issued-client',
        model: { slug: 'gpt-test', displayName: 'Test model' },
      };
      const first = createChatGPTPlanProvider(options).stream!(baseRequest)[Symbol.asyncIterator]();
      const second =
        createChatGPTPlanProvider(options).stream!(baseRequest)[Symbol.asyncIterator]();
      const firstPending = first.next();
      const secondPending = second.next();
      const [firstID, secondID] = bridge.started.map((request) => request.requestID);
      expect(firstID).toBeDefined();
      expect(secondID).toBeDefined();
      expect(firstID).not.toBe(secondID);

      await first.return?.();
      await expect(firstPending).resolves.toEqual({ done: true, value: undefined });
      expect(bridge.cancelled).toEqual([firstID]);
      bridge.emit({ requestId: secondID!, type: 'text_delta', text: 'Second only' });
      bridge.emit({ requestId: secondID!, type: 'completed', text: 'Second only' });
      releases[1]?.();
      await expect(secondPending).resolves.toMatchObject({
        done: false,
        value: { ok: true, value: { type: 'text_delta', text: 'Second only' } },
      });
      await expect(second.next()).resolves.toMatchObject({
        done: false,
        value: { ok: true, value: { type: 'completed' } },
      });
      expect(bridge.cancelled).toEqual([firstID]);
      releases[0]?.();
    } finally {
      now.mockRestore();
    }
  });
});
