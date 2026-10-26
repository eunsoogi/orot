import { describe, expect, it } from '@jest/globals';
import type { LanguageModelRequest } from '@orot/model-runtime';
import {
  createProvider,
  FakeBridge,
  requestWithTools,
  tool,
  toolCall,
} from './tool-calling.test-support';

describe('ChatGPT plan local tool calling', () => {
  it('maps local definitions and streamed function calls to normalized tool calls', async () => {
    const bridge = new FakeBridge(async (requestID, target) => {
      const nativeCall = {
        id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments),
      };
      target.emit({ requestId: requestID, type: 'tool_call', toolCall: nativeCall });
      target.emit({ requestId: requestID, type: 'completed', text: '', toolCalls: [nativeCall] });
    });
    const provider = createProvider(bridge);

    expect(provider.capabilities.toolCalling).toBe(true);
    const iterator = provider.stream!(requestWithTools)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, value: { type: 'tool_call', toolCall } },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        ok: true,
        value: {
          type: 'completed',
          response: { text: '', toolCalls: [toolCall], finishReason: 'tool_calls' },
        },
      },
    });

    expect(bridge.started[0]?.request).toEqual({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Look up source-42.' }],
      tools: [
        {
          type: 'function',
          name: 'lookup_source',
          description: 'Look up one synthetic source.',
          parameters: tool.inputSchema,
          strict: false,
        },
      ],
    });
  });

  it('emits a final call even when the bridge did not stream an arguments-done event', async () => {
    const nativeCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    };
    const bridge = new FakeBridge(async (requestID, target) => {
      target.emit({ requestId: requestID, type: 'completed', text: '', toolCalls: [nativeCall] });
    });
    const provider = createProvider(bridge);
    const iterator = provider.stream!(requestWithTools)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, value: { type: 'tool_call', toolCall } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { ok: true, value: { type: 'completed', response: { toolCalls: [toolCall] } } },
    });
  });

  it('returns local results with the prior Responses output items for final completion', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'rs_synthetic',
      encrypted_content: 'opaque-synthetic-state',
    };
    const functionCallItem = {
      type: 'function_call',
      id: 'fc_synthetic',
      call_id: toolCall.id,
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    };
    const continuationItems = [JSON.stringify(reasoning), JSON.stringify(functionCallItem)];
    const bridge = new FakeBridge(async (requestID, target, requestNumber) => {
      if (requestNumber === 0) {
        const nativeCall = {
          id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        };
        target.emit({ requestId: requestID, type: 'tool_call', toolCall: nativeCall });
        target.emit({
          requestId: requestID,
          type: 'completed',
          text: '',
          toolCalls: [nativeCall],
          continuationItems,
        });
        return;
      }
      target.emit({ requestId: requestID, type: 'text_delta', text: 'Source found.' });
      target.emit({ requestId: requestID, type: 'completed', text: 'Source found.' });
    });
    const provider = createProvider(bridge);
    const first = await provider.generate(requestWithTools);
    expect(first).toEqual({
      ok: true,
      value: { text: '', toolCalls: [toolCall], finishReason: 'tool_calls' },
    });

    const followUp: LanguageModelRequest = {
      messages: [
        { role: 'user', content: 'Look up source-42.' },
        { role: 'assistant', content: '', toolCalls: [toolCall] },
        { role: 'tool', toolCallId: toolCall.id, result: { found: true, sourceId: 'source-42' } },
      ],
      tools: [tool],
    };
    await expect(provider.generate(followUp)).resolves.toEqual({
      ok: true,
      value: { text: 'Source found.', toolCalls: [], finishReason: 'complete' },
    });

    expect(bridge.started[1]?.request.messages).toEqual([
      { role: 'user', content: 'Look up source-42.' },
      { type: 'continuation_item', json: continuationItems[0] },
      { type: 'continuation_item', json: continuationItems[1] },
      {
        type: 'function_call_output',
        callID: toolCall.id,
        output: JSON.stringify({ found: true, sourceId: 'source-42' }),
      },
    ]);
  });

  it('rejects hosted tools before starting the native request', async () => {
    const bridge = new FakeBridge();
    const provider = createProvider(bridge);
    const request = {
      ...requestWithTools,
      tools: [{ ...tool, type: 'web_search' }],
    } as unknown as LanguageModelRequest;

    await expect(provider.generate(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported_capability' },
    });
    expect(bridge.started).toHaveLength(0);
  });
});
