import { expect, it } from '@jest/globals';
import type { LanguageModelRequest, ToolCall } from '@orot/model-runtime';
import { createChatGPTPlanProvider } from '../src';
import { FakeBridge } from './providerTestSupport';
import { CompletedContinuationCache } from '../src/completed-continuation';
import { prepareRequest } from '../src/request-mapper';

const tool = {
  name: 'lookup_source',
  inputSchema: { type: 'object', properties: { sourceId: { type: 'string' } } },
} as const;
const firstCall: ToolCall = {
  id: 'call_first',
  name: tool.name,
  arguments: { sourceId: 'source-1' },
};

it.each(['assistant text', 'tool name', 'tool arguments'] as const)(
  'does not substitute cached opaque items after changing %s under the same tool ID',
  async (change) => {
    let callCount = 0;
    const bridge = new FakeBridge(async (requestId, target) => {
      if (++callCount !== 1) {
        target.emit({ requestId, type: 'completed', text: '' });
        return;
      }
      const toolCall = { ...firstCall, arguments: JSON.stringify(firstCall.arguments) };
      target.emit({
        requestId,
        type: 'completed',
        text: '',
        toolCalls: [toolCall],
        continuationItems: [
          JSON.stringify({
            type: 'function_call',
            id: 'wire-first',
            call_id: firstCall.id,
            name: firstCall.name,
            arguments: toolCall.arguments,
          }),
        ],
      });
    });
    const provider = createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'synthetic-account',
      model: { slug: 'gpt-test', displayName: 'Test model' },
    });
    const initial: LanguageModelRequest = {
      messages: [{ role: 'user', content: 'Read the synthetic source.' }],
      tools: [tool],
    };
    await expect(provider.generate(initial)).resolves.toMatchObject({
      ok: true,
      value: { toolCalls: [firstCall] },
    });
    const call = {
      ...firstCall,
      ...(change === 'tool name' ? { name: 'changed_tool' } : {}),
      ...(change === 'tool arguments' ? { arguments: { sourceId: 'changed' } } : {}),
    };
    const content = change === 'assistant text' ? 'Corrected synthetic text.' : '';
    await expect(
      provider.generate({
        ...initial,
        messages: [
          ...initial.messages,
          { role: 'assistant', content, toolCalls: [call] },
          { role: 'tool', toolCallId: call.id, result: { found: true } },
        ],
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(bridge.started).toHaveLength(2);
    expect(bridge.started[1]?.request.messages).toEqual([
      ...initial.messages,
      ...(content ? [{ role: 'assistant', content }] : []),
      {
        type: 'function_call',
        callID: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
      { type: 'function_call_output', callID: call.id, output: '{"found":true}' },
    ]);
  },
);

it('falls back after an overlapping same-ID completion and after retirement', async () => {
  const cache = new CompletedContinuationCache();
  const event = (id: string, call: ToolCall) => ({
    text: '',
    continuationItems: [
      JSON.stringify({
        type: 'function_call',
        id,
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      }),
    ],
  });
  const read = (call: ToolCall) =>
    prepareRequest(
      'gpt-test',
      {
        messages: [{ role: 'assistant', content: '', toolCalls: [call] }],
      },
      cache,
    );
  const expectOpaque = (result: ReturnType<typeof read>, count: number) => {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Synthetic request unexpectedly rejected.');
    expect(result.consumedContinuations.size).toBe(count);
    return result;
  };
  cache.settle(new Map(), [firstCall], event('older-wire', firstCall));
  const captured = expectOpaque(read(firstCall), 1);
  await Promise.resolve();
  cache.settle(new Map(), [firstCall], event('other-wire', firstCall));
  expectOpaque(cache.choose(captured), 0);
  cache.settle(captured.consumedContinuations, [], { text: 'final' });
  expectOpaque(read(firstCall), 0);

  const nextCall = { ...firstCall, id: 'sequential-id' };
  cache.settle(new Map(), [nextCall], event('next-wire', nextCall));
  const next = expectOpaque(read(nextCall), 1);
  cache.settle(next.consumedContinuations, [], { text: 'final' });
  cache.settle(new Map(), [nextCall], event('repeat-wire', nextCall));
  expectOpaque(read(nextCall), 0);
});
