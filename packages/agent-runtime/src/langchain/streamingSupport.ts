/** Validate terminal native stream metadata before exposing standard chunks. */
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import type { LanguageModelResponse, ProviderError, ToolCall } from '@orot/model-runtime';
import { NativeChatModelError } from './chatModel';

export function chunk(
  text: string,
  finishReason?: LanguageModelResponse['finishReason'],
  calls: readonly ToolCall[] = [],
  index?: number,
  usage?: AIMessageChunk['usage_metadata'],
): ChatGenerationChunk {
  const message = new AIMessageChunk({
    content: text,
    ...(finishReason ? { response_metadata: { finish_reason: finishReason } } : {}),
    ...(usage ? { usage_metadata: usage } : {}),
    ...(calls.length
      ? {
          tool_call_chunks: calls.map((call, offset) => ({
            type: 'tool_call_chunk' as const,
            id: call.id,
            name: call.name,
            args: JSON.stringify(call.arguments),
            index: index ?? offset,
          })),
        }
      : {}),
  });
  return new ChatGenerationChunk({
    text,
    message,
    ...(finishReason ? { generationInfo: { finish_reason: finishReason } } : {}),
  });
}

export function usageMetadata(response: LanguageModelResponse): AIMessageChunk['usage_metadata'] {
  const usage = response.usage;
  if (usage === undefined) return undefined;
  if (!usage || Array.isArray(usage)) throw internalError();
  const counts = [usage.inputTokens, usage.outputTokens, usage.totalTokens];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0)) throw internalError();
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
}

export function validToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== 'object') return false;
  const call = value as ToolCall;
  const validId = typeof call.id === 'string' && !!call.id.trim();
  const validName = typeof call.name === 'string' && !!call.name.trim();
  const validArguments =
    !!call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments);
  return validId && validName && validArguments;
}

export function callsMatch(streamed: readonly ToolCall[], completed: readonly ToolCall[]): boolean {
  // Providers may publish calls only in the terminal response; streamed calls must reconcile exactly.
  return (
    streamed.length === 0 ||
    (streamed.length === completed.length &&
      streamed.every((call, index) => {
        const final = completed[index];
        return (
          final !== undefined &&
          call.id === final.id &&
          call.name === final.name &&
          JSON.stringify(call.arguments) === JSON.stringify(final.arguments)
        );
      }))
  );
}

export function providerError(code: ProviderError['code']): ProviderError {
  return { code, message: '', retryable: false };
}

export function internalError(): NativeChatModelError {
  return new NativeChatModelError(providerError('internal_error'));
}

export function cancelled(): Error {
  return Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
}
