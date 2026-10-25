import type { LanguageModelResponse, ToolCall } from '@orot/model-runtime';
import type { ChatGPTPlanNativeEvent } from './native-contract';

/** Assemble the terminal response only after its optional usage has passed validation. */
export function nativeResponse(
  event: Extract<ChatGPTPlanNativeEvent, { type: 'completed' }>,
  toolCalls: readonly ToolCall[],
): LanguageModelResponse {
  return {
    text: event.text,
    toolCalls,
    finishReason: toolCalls.length ? 'tool_calls' : 'complete',
    ...nativeUsage(event.usage),
  };
}

/** Copy only reported numeric counts. This is not a tokenizer or a missing-total fallback. */
function nativeUsage(value: unknown): Pick<LanguageModelResponse, 'usage'> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('Malformed native token usage.'), { kind: 'malformed_response' });
  const usage = value as Record<string, unknown>;
  const counts = [usage.inputTokens, usage.outputTokens, usage.totalTokens];
  if (!counts.every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0))
    throw Object.assign(new Error('Malformed native token usage.'), { kind: 'malformed_response' });
  return { usage: {
    inputTokens: usage.inputTokens as number,
    outputTokens: usage.outputTokens as number,
    totalTokens: usage.totalTokens as number,
  } };
}
