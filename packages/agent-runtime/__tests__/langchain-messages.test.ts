import {
  AIMessage,
  AIMessageChunk,
  ChatMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { LanguageModelMessage } from '@orot/model-runtime';
import {
  MessageConversionError,
  toLangChainMessages,
  toNativeMessages,
} from '../src/langchain/messages';

describe('native LangChain message conversion', () => {
  it('round-trips native roles, multiple calls, nested arguments, and JSON results', () => {
    const messages: LanguageModelMessage[] = [
      { role: 'system', content: 'Instructions' },
      { role: 'user', content: [{ type: 'text', text: 'Question' }] },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-a', name: 'search', arguments: { query: 'records', limit: 2 } },
          { id: 'call-b', name: 'lookup', arguments: { filters: { kinds: ['sleep', null] } } },
        ],
      },
      { role: 'tool', toolCallId: 'call-a', result: { records: [1, false, null] } },
      { role: 'tool', toolCallId: 'call-b', result: 'null' },
      { role: 'assistant', content: 'Answer' },
    ];
    const converted = toNativeMessages(toLangChainMessages(messages));
    expect(converted.messages).toEqual(messages);
    expect(converted.metadata.map((entry) => entry.id)).toEqual(messages.map(() => undefined));
  });

  it('keeps IDs and assistant/tool text block segmentation outside the native wire', () => {
    const messages = [
      new SystemMessage({ content: '', id: 'system-id' }),
      new HumanMessage({ content: [], id: 'user-id', name: 'patient' }),
      new AIMessage({
        content: [
          { type: 'text', text: 'One' },
          { type: 'text', text: ' two' },
        ],
        id: 'assistant-id',
        tool_calls: [{ id: 'call-id', name: 'search', args: { nested: [1, { ok: true }] } }],
      }),
      new ToolMessage({
        content: [{ type: 'text', text: 'Result' }],
        tool_call_id: 'call-id',
        id: 'tool-message-id',
        name: 'search',
      }),
    ];
    const converted = toNativeMessages(messages);
    expect(converted.messages[2]).toEqual({
      role: 'assistant',
      content: 'One two',
      toolCalls: [{ id: 'call-id', name: 'search', arguments: { nested: [1, { ok: true }] } }],
    });
    expect(converted.messages[3]).toEqual({
      role: 'tool',
      toolCallId: 'call-id',
      result: 'Result',
    });
    const restored = toLangChainMessages(converted.messages, converted.metadata);
    expect(
      restored.map((message) => [message.type, message.id, message.name, message.content]),
    ).toEqual(messages.map((message) => [message.type, message.id, message.name, message.content]));
    expect(toNativeMessages(restored)).toEqual(converted);
    expect(JSON.stringify(converted.messages)).not.toContain('assistant-id');
    expect(JSON.stringify(converted.messages)).not.toContain('textBlocks');
  });

  it.each([
    { type: 'image_url', image_url: 'https://example.test/image' },
    { type: 'audio', data: 'sound' },
    { type: 'video', data: 'video' },
    { type: 'reasoning', text: 'reason' },
    { type: 'text', text: 7 },
    { type: 'text', text: 'Text', extra: 'unsupported' },
    { type: 'unknown' },
  ])('rejects unsupported LangChain blocks %j', (block) => {
    for (const Message of [SystemMessage, HumanMessage, AIMessage]) {
      const message = new Message({ content: [block] } as never);
      expect(() => toNativeMessages([message])).toThrow(MessageConversionError);
    }
    expect(() =>
      toNativeMessages([new ToolMessage({ content: [block], tool_call_id: 'call' } as never)]),
    ).toThrow(MessageConversionError);
  });

  it.each(['image', 'audio'] as const)('rejects native %s input without discarding it', (type) => {
    expect(() =>
      toLangChainMessages([
        { role: 'user', content: [{ type, data: new Uint8Array([1]), mediaType: `${type}/test` }] },
      ]),
    ).toThrow(MessageConversionError);
  });

  it('rejects chunks, generic roles, legacy calls, and invalid normalized calls', () => {
    const messages = [
      new AIMessageChunk({ content: 'partial' }),
      new ChatMessage({ role: 'custom', content: 'text' }),
      new AIMessage({
        content: '',
        additional_kwargs: { function_call: { name: 'search', arguments: '{}' } },
      }),
      new AIMessage({ content: '', invalid_tool_calls: [{ name: 'search', args: '{' }] }),
      new AIMessage({ content: '', tool_calls: [{ name: 'search', args: {} }] }),
      new ToolMessage({ content: 'text', tool_call_id: ' ' }),
      new ToolMessage({ content: 'error', tool_call_id: 'call', status: 'error' }),
    ];
    for (const message of messages)
      expect(() => toNativeMessages([message])).toThrow(MessageConversionError);
  });

  it.each([undefined, NaN, Infinity, new Date(), [1], { nested: undefined }])(
    'rejects invalid tool argument objects %p',
    (args) => {
      const message = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call', name: 'search', args }],
      } as never);
      expect(() => toNativeMessages([message])).toThrow(MessageConversionError);
    },
  );

  it('rejects mismatched sidecars rather than restoring metadata onto changed text', () => {
    expect(() => toLangChainMessages([{ role: 'assistant', content: 'text' }], [])).toThrow(
      MessageConversionError,
    );
    expect(() =>
      toLangChainMessages(
        [{ role: 'assistant', content: 'changed' }],
        [{ textBlocks: [{ type: 'text', text: 'original' }] }],
      ),
    ).toThrow(MessageConversionError);
  });

  it('rejects malformed native assistant content and sparse text blocks', () => {
    expect(() => toLangChainMessages([{ role: 'assistant', content: [] } as never])).toThrow(
      MessageConversionError,
    );
    expect(() => toNativeMessages([new HumanMessage({ content: Array(1) })])).toThrow(
      MessageConversionError,
    );
  });

  it('uses normalized calls when LangChain also retains the raw provider payload', () => {
    const message = new AIMessage({
      content: '',
      tool_calls: [{ id: 'call', name: 'search', args: { query: 'records' } }],
      additional_kwargs: {
        tool_calls: [
          {
            id: 'call',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"records"}' },
          },
        ],
      },
    });
    expect(toNativeMessages([message]).messages).toEqual([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call', name: 'search', arguments: { query: 'records' } }],
      },
    ]);
  });
});
