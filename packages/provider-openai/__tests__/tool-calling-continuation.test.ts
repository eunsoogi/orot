import { describe, expect, it } from '@jest/globals';
import type { LanguageModelRequest, ToolCall } from '@orot/model-runtime';
import { createChatGPTPlanProvider } from '../src';
import type { ChatGPTPlanNativeBridge, ChatGPTPlanNativeEvent, ChatGPTPlanRequest } from '../src';

const tool = {
  name: 'lookup_source',
  inputSchema: { type: 'object', properties: { sourceId: { type: 'string' } } },
} as const;
const firstCall: ToolCall = {
  id: 'call_first',
  name: tool.name,
  arguments: { sourceId: 'source-1' },
};
const secondCall: ToolCall = {
  id: 'call_second',
  name: tool.name,
  arguments: { sourceId: 'source-2' },
};
const firstItems = [
  JSON.stringify({ type: 'reasoning', id: 'rs_first', encrypted_content: 'first-reasoning' }),
  JSON.stringify({
    type: 'function_call',
    id: 'fc_first',
    call_id: firstCall.id,
    name: tool.name,
    arguments: JSON.stringify(firstCall.arguments),
  }),
];
const secondItems = [
  JSON.stringify({ type: 'reasoning', id: 'rs_second', encrypted_content: 'second-reasoning' }),
  JSON.stringify({
    type: 'function_call',
    id: 'fc_second',
    call_id: secondCall.id,
    name: tool.name,
    arguments: JSON.stringify(secondCall.arguments),
  }),
];

describe('ChatGPT plan continuation across consecutive local tools', () => {
  it('keeps each Responses output item alongside its local result until the final answer', async () => {
    const bridge = new SequentialToolBridge();
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'issued-client',
      model: { slug: 'gpt-test', displayName: 'Test model' },
      requestIDFactory: (() => {
        let next = 0;
        return () => `request-${++next}`;
      })(),
    });
    const initial: LanguageModelRequest = {
      messages: [{ role: 'user', content: 'Resolve source-1 and source-2.' }],
      tools: [tool],
    };
    const firstFollowUp: LanguageModelRequest = {
      messages: [
        { role: 'user', content: 'Resolve source-1 and source-2.' },
        { role: 'assistant', content: '', toolCalls: [firstCall] },
        { role: 'tool', toolCallId: firstCall.id, result: { found: true } },
      ],
      tools: [tool],
    };
    const secondFollowUp: LanguageModelRequest = {
      messages: [
        { role: 'user', content: 'Resolve source-1 and source-2.' },
        { role: 'assistant', content: '', toolCalls: [firstCall] },
        { role: 'tool', toolCallId: firstCall.id, result: { found: true } },
        { role: 'assistant', content: '', toolCalls: [secondCall] },
        { role: 'tool', toolCallId: secondCall.id, result: { found: true } },
      ],
      tools: [tool],
    };

    await expect(provider.generate(initial)).resolves.toMatchObject({
      ok: true,
      value: { toolCalls: [firstCall] },
    });
    await expect(provider.generate(firstFollowUp)).resolves.toMatchObject({
      ok: true,
      value: { toolCalls: [secondCall] },
    });
    await expect(provider.generate(secondFollowUp)).resolves.toMatchObject({
      ok: true,
      value: { text: 'Both sources found.', toolCalls: [] },
    });

    expect(bridge.started[2]?.messages).toEqual([
      { role: 'user', content: 'Resolve source-1 and source-2.' },
      ...firstItems.map((json) => ({ type: 'continuation_item', json })),
      {
        type: 'function_call_output',
        callID: firstCall.id,
        output: JSON.stringify({ found: true }),
      },
      ...secondItems.map((json) => ({ type: 'continuation_item', json })),
      {
        type: 'function_call_output',
        callID: secondCall.id,
        output: JSON.stringify({ found: true }),
      },
    ]);
  });
});

class SequentialToolBridge implements ChatGPTPlanNativeBridge {
  readonly started: ChatGPTPlanRequest[] = [];
  private readonly listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();

  async listModels() {
    return [{ slug: 'gpt-test', displayName: 'Test model' }];
  }
  subscribe(listener: (event: ChatGPTPlanNativeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async startResponse(requestId: string, _clientId: string, request: ChatGPTPlanRequest) {
    this.started.push(request);
    const step = this.started.length;
    if (step === 1) return this.toolResponse(requestId, firstCall, firstItems);
    if (step === 2) return this.toolResponse(requestId, secondCall, secondItems);
    this.emit({ requestId, type: 'text_delta', text: 'Both sources found.' });
    this.emit({ requestId, type: 'completed', text: 'Both sources found.' });
  }
  cancelResponse() {}

  private toolResponse(requestId: string, call: ToolCall, continuationItems: readonly string[]) {
    const toolCall = { id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) };
    this.emit({ requestId, type: 'tool_call', toolCall });
    this.emit({ requestId, type: 'completed', text: '', toolCalls: [toolCall], continuationItems });
  }
  private emit(event: ChatGPTPlanNativeEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
