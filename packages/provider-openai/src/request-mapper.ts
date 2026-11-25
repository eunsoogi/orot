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

import type { CompletedContinuation, CompletedContinuationCache } from './completed-continuation';

const RESPONSE_ITEM_TYPES = new Set(['function_call', 'message', 'reasoning']);

type PreparedRequest =
  | {
      readonly ok: true;
      readonly value: ChatGPTPlanRequest;
      readonly consumedContinuations: ReadonlyMap<string, CompletedContinuation>;
      readonly withoutOpaque?: PreparedRequest;
    }
  | { readonly ok: false; readonly error: ProviderError };

export function prepareRequest(
  model: string,
  request: LanguageModelRequest,
  continuationsByCallID?: CompletedContinuationCache,
): PreparedRequest {
  if (request.responseFormat) return unsupportedCapability('structured output');
  if (request.maxOutputTokens !== undefined) return unsupportedCapability('max output tokens');
  if (request.temperature !== undefined) return unsupportedCapability('temperature');

  const tools = mapTools(request.tools);
  if (!tools.ok) return tools;
  if (request.toolChoice === 'required' && !tools.value.length)
    return invalidRequest('Required tool selection needs tools.');

  const messages: ChatGPTPlanInputMessage[] = [];
  const consumedContinuations = new Map<string, CompletedContinuation>();
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
      const content = textContent(message.content);
      if (!content.ok) return { ok: false, error: content.error };
      const continuation = continuationFor(content.value, message.toolCalls, continuationsByCallID);
      if (continuation) {
        // Replaying raw Responses items preserves provider context that normalized tool calls omit.
        for (const json of continuation.items) {
          if (!isSupportedResponseItem(json))
            return invalidRequest('A cached Responses item was invalid.');
          messages.push({ type: 'continuation_item', json });
        }
        for (const call of message.toolCalls) consumedContinuations.set(call.id, continuation);
        continue;
      }

      if (content.value) messages.push({ role: 'assistant', content: content.value });
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
    ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
  };
  return {
    ok: true,
    value,
    consumedContinuations,
    ...(consumedContinuations.size ? { withoutOpaque: prepareRequest(model, request) } : {}),
  };
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
  text: string,
  toolCalls: readonly ToolCall[],
  continuationsByCallID: CompletedContinuationCache | undefined,
): CompletedContinuation | undefined {
  if (!continuationsByCallID || !toolCalls.length) return undefined;
  const record = continuationsByCallID.get(toolCalls[0]!.id);
  // Identifiers do not authorize reuse of a different assistant message or tool call.
  if (
    !record ||
    record.text !== text ||
    record.toolCalls.length !== toolCalls.length ||
    !toolCalls.every(
      (call, index) =>
        continuationsByCallID.get(call.id) === record &&
        call.id === record.toolCalls[index]!.id &&
        call.name === record.toolCalls[index]!.name &&
        stringifyJson(call.arguments) === record.toolCalls[index]!.arguments,
    )
  )
    return undefined;
  return record;
}

function isSupportedResponseItem(json: string): boolean {
  try {
    const item: unknown = JSON.parse(json);
    if (!isJsonObject(item)) return false;
    const type = item.type;
    if (typeof type !== 'string' || !RESPONSE_ITEM_TYPES.has(type)) return false;
    if (type !== 'function_call') return true;
    // Match the native builder before replaying an opaque function item. The
    // continuation is provider context, not permission to accept malformed calls.
    if (
      ![item.id, item.call_id, item.name].every(
        (value) => typeof value === 'string' && value.length > 0,
      ) ||
      typeof item.arguments !== 'string'
    )
      return false;
    return isJsonObject(JSON.parse(item.arguments));
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
