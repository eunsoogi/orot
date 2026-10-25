import { describe, expect, it } from '@jest/globals';
import {
  createProvider,
  FakeBridge,
  requestWithTools,
  toolCall,
} from './tool-calling.test-support';

describe('ChatGPT plan tool-call errors and cancellation', () => {
  it.each(['not-json', '[]'])(
    'fails and cancels on malformed streamed function arguments: %s',
    async (argumentsJSON) => {
      const bridge = new FakeBridge(async (requestID, target) => {
        target.emit({
          requestId: requestID,
          type: 'tool_call',
          toolCall: { id: toolCall.id, name: toolCall.name, arguments: argumentsJSON },
        });
      });
      const provider = createProvider(bridge);

      await expect(
        provider.stream!(requestWithTools)[Symbol.asyncIterator]().next(),
      ).resolves.toMatchObject({
        done: false,
        value: { ok: false, error: { code: 'internal_error', retryable: false } },
      });
      expect(bridge.cancelled).toEqual(['request-1']);
    },
  );

  it('maps a native malformed-response event to a non-retryable internal error', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({ requestId: requestID, type: 'failed', error: { kind: 'malformed_response' } });
    });
    const provider = createProvider(bridge);

    await expect(provider.generate(requestWithTools)).resolves.toEqual({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'ChatGPT returned a malformed response.',
        retryable: false,
      },
    });
  });

  it('preserves a failure after a streamed tool call', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({
        requestId: requestID,
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      });
      target.emit({ requestId: requestID, type: 'failed', error: { kind: 'usage_limit' } });
    });
    const provider = createProvider(bridge);
    const iterator = provider.stream!(requestWithTools)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { ok: true, value: { type: 'tool_call', toolCall } },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        ok: false,
        error: {
          code: 'rate_limited',
          message: 'The ChatGPT plan usage limit was reached.',
          retryable: false,
        },
      },
    });
  });

  it('preserves an interrupted-stream error after a streamed tool call', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({
        requestId: requestID,
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      });
      target.emit({ requestId: requestID, type: 'failed', error: { kind: 'interrupted' } });
    });
    const provider = createProvider(bridge);
    const iterator = provider.stream!(requestWithTools)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { ok: true, value: { type: 'tool_call', toolCall } },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        ok: false,
        error: {
          code: 'provider_unavailable',
          message: 'ChatGPT ended before completing the response.',
          retryable: false,
        },
      },
    });
  });

  it('cancels native work when the consumer returns after receiving a tool call', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({
        requestId: requestID,
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      });
    });
    const provider = createProvider(bridge);
    const iterator = provider.stream!(requestWithTools)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { ok: true } });
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined });
    expect(bridge.cancelled).toEqual(['request-1']);
  });
});
