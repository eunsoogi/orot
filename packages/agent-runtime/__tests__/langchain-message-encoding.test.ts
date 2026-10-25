import { ToolMessage } from '@langchain/core/messages';
import type { JsonValue, LanguageModelMessage } from '@orot/model-runtime';
import {
  MessageConversionError,
  toLangChainMessages,
  toNativeMessages,
} from '../src/langchain/messages';

describe('native tool result encoding', () => {
  it.each(['null', '42', '{"ok":true}', 'plain text', ''])(
    'does not guess JSON in tool text %s',
    (content) => {
      const message = new ToolMessage({ content, tool_call_id: 'call' });
      const converted = toNativeMessages([message]);
      expect(converted.messages).toEqual([{ role: 'tool', toolCallId: 'call', result: content }]);
      expect(toLangChainMessages(converted.messages)[0].content).toBe(content);
    },
  );

  it.each<JsonValue>([null, 42, true, [], {}, [null, { text: 'value' }]])(
    'round-trips non-string native tool results %j',
    (result) => {
      const messages: LanguageModelMessage[] = [{ role: 'tool', toolCallId: 'call', result }];
      const converted = toLangChainMessages(messages);
      expect(converted[0].content).toBe(JSON.stringify(result));
      expect(toNativeMessages(converted).messages).toEqual(messages);
    },
  );

  it('excludes private artifacts from model input', () => {
    const converted = toNativeMessages([
      new ToolMessage({
        content: 'Public summary',
        tool_call_id: 'call',
        artifact: { private: 'secret' },
      }),
    ]);
    expect(converted.messages).toEqual([
      { role: 'tool', toolCallId: 'call', result: 'Public summary' },
    ]);
    expect(JSON.stringify(converted)).not.toContain('secret');
  });

  it('rejects cyclic, sparse, and non-JSON native results before serialization', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const result of [cyclic, Array(2), NaN, { nested: undefined }, new Date()]) {
      expect(() =>
        toLangChainMessages([{ role: 'tool', toolCallId: 'call', result } as never]),
      ).toThrow(MessageConversionError);
    }
  });

  it('rejects malformed or unknown tool result encodings', () => {
    for (const [encoding, content] of [
      ['json', '{'],
      ['binary', 'data'],
    ]) {
      const message = new ToolMessage({
        content,
        tool_call_id: 'call',
        metadata: { 'orot.nativeToolResultEncoding': encoding },
      });
      expect(() => toNativeMessages([message])).toThrow(MessageConversionError);
    }
  });

  it('restores explicitly encoded JSON text including whitespace and string values', () => {
    for (const content of ['"null"', '{ "ok": true }']) {
      const message = new ToolMessage({
        content,
        tool_call_id: 'call',
        metadata: { 'orot.nativeToolResultEncoding': 'json' },
      });
      const native = toNativeMessages([message]);
      const restored = toLangChainMessages(native.messages, native.metadata);
      expect(restored[0].content).toBe(content);
      expect(toNativeMessages(restored)).toEqual(native);
      expect(() =>
        toLangChainMessages(
          [{ role: 'tool', toolCallId: 'call', result: 'changed' }],
          native.metadata,
        ),
      ).toThrow(MessageConversionError);
    }
  });
});
