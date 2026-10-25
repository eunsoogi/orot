import {
  AIMessage,
  BaseMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { JsonObject, JsonValue, LanguageModelMessage } from '@orot/model-runtime';

type TextBlock = { type: 'text'; text: string };
type MessageMetadata = {
  readonly id?: string;
  readonly name?: string;
  readonly textBlocks?: readonly TextBlock[];
  readonly toolJsonText?: string;
};

/** Only messages belong on the native wire; metadata restores LangChain-only fields. */
export interface NativeMessageConversion {
  readonly messages: readonly LanguageModelMessage[];
  readonly metadata: readonly MessageMetadata[];
}

const resultEncodingKey = 'orot.nativeToolResultEncoding';

/** Errors describe the boundary, never echoing private message or tool payloads. */
export class MessageConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageConversionError';
  }
}

function reject(reason: string): never {
  throw new MessageConversionError(reason);
}

function textContent(content: unknown): string | TextBlock[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return reject('Message content must be text.');
  return Array.from(content, (block) => {
    if (
      !block ||
      block.type !== 'text' ||
      typeof block.text !== 'string' ||
      Object.keys(block).some((key) => key !== 'type' && key !== 'text')
    )
      return reject('Unsupported or malformed content block.');
    return { type: 'text', text: block.text };
  });
}

function flatten(content: string | readonly TextBlock[]): string {
  return typeof content === 'string' ? content : content.map((block) => block.text).join('');
}

function identity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return reject('Tool identity is required.');
  return value;
}

/** Validate before JSON serialization: JSON.stringify otherwise silently changes invalid values. */
function jsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value))
    return reject('Tool data must be finite, acyclic JSON.');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    return reject('Tool data must use plain JSON objects.');
  if (Object.getOwnPropertySymbols(value).length) return reject('Unsupported JSON symbol key.');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? Array.from(value, (item) => jsonValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, jsonValue(item, ancestors)]),
      );
  ancestors.delete(value);
  return result;
}

function jsonObject(value: unknown): JsonObject {
  const result = jsonValue(value);
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return reject('Tool arguments must be a JSON object.');
  return result as JsonObject;
}

/** Untagged text stays text; only this adapter's explicit marker enables JSON decoding. */
function toolResult(message: ToolMessage, content: string): JsonValue {
  const encoding = message.metadata?.[resultEncodingKey];
  if (encoding === undefined) return content;
  if (encoding !== 'json') return reject('Unsupported tool result encoding.');
  try {
    return jsonValue(JSON.parse(content));
  } catch {
    return reject('Malformed JSON tool result.');
  }
}

/** Convert complete LangChain messages without changing the provider request contract. */
export function toNativeMessages(messages: readonly BaseMessage[]): NativeMessageConversion {
  const metadata: MessageMetadata[] = [];
  const converted = messages.map((message): LanguageModelMessage => {
    if (BaseMessageChunk.isInstance(message)) return reject('Message chunks are unsupported.');
    // Normalized calls are authoritative; LangChain may retain their provider payload alongside them.
    if (
      message.additional_kwargs.function_call ||
      (message.additional_kwargs.tool_calls &&
        (!AIMessage.isInstance(message) || !message.tool_calls?.length))
    )
      return reject('Legacy tool calls are unsupported; use normalized tool_calls.');
    const content = textContent(message.content);
    const role = message.type;
    metadata.push({
      ...(message.id !== undefined ? { id: message.id } : {}),
      ...(message.name !== undefined ? { name: message.name } : {}),
      ...(ToolMessage.isInstance(message) && message.metadata?.[resultEncodingKey] === 'json'
        ? { toolJsonText: flatten(content) }
        : {}),
      ...((role === 'ai' || role === 'tool') && Array.isArray(content)
        ? { textBlocks: content }
        : {}),
    });
    if (role === 'system' || role === 'human')
      return { role: role === 'human' ? 'user' : 'system', content };
    if (AIMessage.isInstance(message)) {
      if (message.invalid_tool_calls?.length) return reject('Invalid tool calls are unsupported.');
      return {
        role: 'assistant',
        content: flatten(content),
        ...(message.tool_calls?.length
          ? {
              toolCalls: message.tool_calls.map((call) => ({
                id: identity(call.id),
                name: identity(call.name),
                arguments: jsonObject(call.args),
              })),
            }
          : {}),
      };
    }
    if (ToolMessage.isInstance(message)) {
      if (message.status === 'error') return reject('Tool error status has no native equivalent.');
      // artifact is deliberately excluded: LangChain defines it as not intended for model input.
      return {
        role: 'tool',
        toolCallId: identity(message.tool_call_id),
        result: toolResult(message, flatten(content)),
      };
    }
    return reject('Unsupported message role.');
  });
  return { messages: converted, metadata };
}

/** Restore text-block segmentation only when it still matches the native text. */
function restoredContent(content: string, metadata?: MessageMetadata): string | TextBlock[] {
  if (typeof content !== 'string') return reject('Native assistant content must be a string.');
  if (!metadata?.textBlocks) return content;
  const blocks = textContent(metadata.textBlocks);
  if (flatten(blocks) !== content) return reject('Content metadata does not match native text.');
  return blocks;
}

/** Convert native data to standard messages; optional sidecar fields never enter native requests. */
export function toLangChainMessages(
  messages: readonly LanguageModelMessage[],
  metadata?: readonly MessageMetadata[],
): BaseMessage[] {
  if (metadata && metadata.length !== messages.length)
    return reject('Message metadata length must match the message count.');
  return messages.map((message, index) => {
    const fields = metadata?.[index];
    const common = { id: fields?.id, name: fields?.name };
    if (message.role === 'system' || message.role === 'user') {
      const content = textContent(message.content);
      return message.role === 'system'
        ? new SystemMessage({ ...common, content })
        : new HumanMessage({ ...common, content });
    }
    if (message.role === 'assistant')
      return new AIMessage({
        ...common,
        content: restoredContent(message.content, fields),
        tool_calls: message.toolCalls?.map((call) => ({
          type: 'tool_call',
          id: identity(call.id),
          name: identity(call.name),
          args: jsonObject(call.arguments),
        })),
      });
    if (message.role === 'tool') {
      const result = jsonValue(message.result);
      // String results require no encoding; JSON-looking strings must remain strings.
      const encoded = fields?.toolJsonText !== undefined || typeof result !== 'string';
      const content = fields?.toolJsonText ?? (encoded ? JSON.stringify(result) : result);
      if (fields?.toolJsonText !== undefined) {
        try {
          if (JSON.stringify(jsonValue(JSON.parse(content))) !== JSON.stringify(result))
            return reject('Tool JSON metadata does not match the native result.');
        } catch {
          return reject('Invalid tool JSON metadata.');
        }
      }
      return new ToolMessage({
        ...common,
        tool_call_id: identity(message.toolCallId),
        content: restoredContent(content, fields),
        ...(encoded ? { metadata: { [resultEncodingKey]: 'json' } } : {}),
      });
    }
    return reject('Unsupported native message role.');
  });
}
