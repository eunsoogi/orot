import type {
  JsonObject,
  LanguageModelInputPart,
  LanguageModelRequest,
  ProviderError,
  ToolCall,
  ToolDefinition,
} from '@orot/model-runtime';
import type {
  ChatGPTPlanInputMessage,
  ChatGPTPlanRequest,
  ChatGPTPlanToolDefinition,
} from './native-contract';

const RESPONSE_ITEM_TYPES = new Set(['function_call', 'message', 'reasoning']);

export function prepareRequest(
  model: string,
  request: LanguageModelRequest,
  continuationsByCallID?: ReadonlyMap<string, readonly string[]>,
):
  | {
      readonly ok: true;
      readonly value: ChatGPTPlanRequest;
      readonly consumedCallIDs: readonly string[];
    }
  | { readonly ok: false; readonly error: ProviderError } {
  if (request.responseFormat) return unsupportedCapability('structured output');
  if (request.maxOutputTokens !== undefined) return unsupportedCapability('max output tokens');
  if (request.temperature !== undefined) return unsupportedCapability('temperature');

  const tools = mapTools(request.tools);
  if (!tools.ok) return tools;

  const messages: ChatGPTPlanInputMessage[] = [];
  const consumedCallIDs: string[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId.trim())
        return invalidRequest('A local tool result did not include its function-call id.');
      const output = stringifyJson(message.result);
      if (output === undefined) return invalidRequest('A local tool result was not valid JSON.');
      messages.push({ type: 'function_call_output', callID: message.toolCallId, output });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const continuation = continuationFor(message.toolCalls, continuationsByCallID);
      if (continuation) {
        // Replaying raw Responses items preserves provider context that normalized tool calls omit.
        for (const json of continuation.items) {
          if (!isSupportedResponseItem(json))
            return invalidRequest('A cached Responses item was invalid.');
          messages.push({ type: 'continuation_item', json });
        }
        consumedCallIDs.push(...continuation.callIDs);
        continue;
      }

      if (message.content) messages.push({ role: 'assistant', content: message.content });
      for (const toolCall of message.toolCalls) {
        if (!toolCall.id.trim() || !toolCall.name.trim() || !isJsonObject(toolCall.arguments)) {
          return invalidRequest('A local function call was malformed.');
        }
        const argumentsJSON = stringifyJson(toolCall.arguments);
        if (argumentsJSON === undefined)
          return invalidRequest('A local tool call argument object was not valid JSON.');
        messages.push({
          type: 'function_call',
          callID: toolCall.id,
          name: toolCall.name,
          arguments: argumentsJSON,
        });
      }
      continue;
    }

    const content = textContent(message.content);
    if (!content.ok) return { ok: false, error: content.error };
    messages.push({ role: message.role, content: content.value });
  }

  const value: ChatGPTPlanRequest = {
    model,
    messages,
    ...(tools.value.length ? { tools: tools.value } : {}),
  };
  return { ok: true, value, consumedCallIDs };
}

function mapTools(
  tools: readonly ToolDefinition[] | undefined,
):
  | { readonly ok: true; readonly value: readonly ChatGPTPlanToolDefinition[] }
  | { readonly ok: false; readonly error: ProviderError } {
  const result: ChatGPTPlanToolDefinition[] = [];
  for (const tool of tools ?? []) {
    const candidate = tool as ToolDefinition & { readonly type?: unknown };
    if (candidate.type !== undefined && candidate.type !== 'function') {
      return unsupportedCapability('hosted tools');
    }
    if (typeof tool.name !== 'string' || !tool.name.trim() || !isJsonObject(tool.inputSchema)) {
      return invalidRequest('A local function tool definition was malformed.');
    }
    if (tool.description !== undefined && typeof tool.description !== 'string') {
      return invalidRequest('A local function tool description was malformed.');
    }
    result.push({
      type: 'function',
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.inputSchema,
      strict: false,
    });
  }
  return { ok: true, value: result };
}

function continuationFor(
  toolCalls: readonly ToolCall[],
  continuationsByCallID: ReadonlyMap<string, readonly string[]> | undefined,
): { readonly items: readonly string[]; readonly callIDs: readonly string[] } | undefined {
  if (!continuationsByCallID || toolCalls.length === 0) return undefined;
  const callIDs = toolCalls.map((toolCall) => toolCall.id);
  const continuations = callIDs.map((callID) => continuationsByCallID.get(callID));
  const first = continuations[0];
  if (!first || continuations.some((items) => !items || !sameStrings(first, items)))
    return undefined;
  return { items: first, callIDs };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isSupportedResponseItem(json: string): boolean {
  try {
    const item: unknown = JSON.parse(json);
    if (!isJsonObject(item)) return false;
    const type = item.type;
    return typeof type === 'string' && RESPONSE_ITEM_TYPES.has(type);
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function textContent(
  content: string | readonly LanguageModelInputPart[],
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: ProviderError } {
  if (typeof content === 'string') return { ok: true, value: content };
  let text = '';
  for (const part of content) {
    if (part.type !== 'text') {
      return {
        ok: false,
        error: {
          code: 'unsupported_input',
          message: `ChatGPT plan inference does not support ${part.type} input.`,
          retryable: false,
        },
      };
    }
    text += part.text;
  }
  return { ok: true, value: text };
}

function unsupportedCapability(name: string): {
  readonly ok: false;
  readonly error: ProviderError;
} {
  return {
    ok: false,
    error: {
      code: 'unsupported_capability',
      message: `ChatGPT plan inference does not support ${name}.`,
      retryable: false,
    },
  };
}

function invalidRequest(message: string): { readonly ok: false; readonly error: ProviderError } {
  return { ok: false, error: { code: 'invalid_request', message, retryable: false } };
}
