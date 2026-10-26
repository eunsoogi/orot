import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { IterableReadableStream } from '@langchain/core/utils/stream';
import type {
  LanguageModelProvider,
  LanguageModelResponse,
  ProviderError,
  ToolCall,
} from '@orot/model-runtime';
import {
  NativeChatModel,
  NativeChatModelError,
  type NativeChatModelCallOptions,
} from './chatModel';
import { toNativeMessages } from './messages';

export type NativeChatModelStreamMode = 'append-only' | 'buffered';

/** Explicit adapter for providers whose stream event text semantics are known by the caller. */
export class NativeStreamingChatModel extends NativeChatModel {
  constructor(
    provider: LanguageModelProvider,
    private readonly streamMode: NativeChatModelStreamMode,
  ) {
    super(provider);
    // Missing capability or transport keeps the base invoke-once fallback.
    this.disableStreaming =
      !provider.capabilities.streaming || typeof provider.stream !== 'function';
  }

  /** Avoids callback setup and eager reads; iterator closure does not promise native inference stops. */
  override async stream(
    input: BaseLanguageModelInput,
    options?: Partial<NativeChatModelCallOptions>,
  ): Promise<IterableReadableStream<AIMessageChunk>> {
    const iterator = this._streamIterator(input, options);
    return new IterableReadableStream<AIMessageChunk>(
      {
        async pull(controller) {
          const result = await iterator.next();
          if (result.done) controller.close();
          else controller.enqueue(result.value);
        },
        async cancel() {
          await iterator.return(undefined);
        },
      },
      { highWaterMark: 0 },
    );
  }

  /** The base iterator starts LangChain callbacks before this adapter can suppress private data. */
  override async *_streamIterator(
    input: BaseLanguageModelInput,
    options?: Partial<NativeChatModelCallOptions>,
  ): AsyncGenerator<AIMessageChunk> {
    if (this.disableStreaming) {
      yield await this.invoke(input, options);
      return;
    }
    const [, callOptions] = this._separateRunnableConfigFromCallOptionsCompat(options);
    const messages = BaseChatModel._convertInputToPromptValue(input).toChatMessages();
    for await (const generationChunk of convertNativeStream(
      this.provider,
      messages,
      callOptions,
      this.streamMode,
    )) {
      if (callOptions.signal?.aborted) throw cancelled();
      yield generationChunk.message as AIMessageChunk;
      // Check again before the next async-iterator read so an abort between chunks does not pull upstream.
      if (callOptions.signal?.aborted) throw cancelled();
    }
    if (callOptions.signal?.aborted) throw cancelled();
  }
}

async function* convertNativeStream(
  provider: LanguageModelProvider,
  messages: BaseMessage[],
  options: NativeChatModelCallOptions,
  mode: NativeChatModelStreamMode,
): AsyncGenerator<ChatGenerationChunk> {
  validateOptions(provider, options);
  if (options.signal?.aborted) throw cancelled();
  const request = {
    messages: toNativeMessages(messages).messages,
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  };
  let text = '';
  let completed: LanguageModelResponse | undefined;
  const streamedCalls: ToolCall[] = [];
  try {
    for await (const result of provider.stream!(request, { signal: options.signal })) {
      if (options.signal?.aborted) throw cancelled();
      if (!result.ok) throw new NativeChatModelError(result.error);
      const event = result.value;
      if (event.type === 'text_delta') {
        if (typeof event.text !== 'string') throw internalError();
        text += event.text;
        if (mode === 'append-only' && event.text) yield chunk(event.text);
      } else if (event.type === 'text_snapshot') {
        if (typeof event.text !== 'string') throw internalError();
        if (mode === 'buffered') text = event.text;
        else throw new NativeChatModelError(providerError('unsupported_capability'));
      } else if (event.type === 'tool_call') {
        if (
          !validToolCall(event.toolCall) ||
          streamedCalls.some((call) => call.id === event.toolCall.id)
        )
          throw internalError();
        streamedCalls.push(event.toolCall);
        if (mode === 'append-only')
          yield chunk('', undefined, [event.toolCall], streamedCalls.length - 1);
      } else if (event.type === 'completed') {
        completed = event.response;
        break;
      } else {
        throw internalError();
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw cancelled();
    if (error instanceof NativeChatModelError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw cancelled(); // Redact provider diagnostics.
    throw internalError();
  }
  if (!completed || typeof completed.text !== 'string' || !Array.isArray(completed.toolCalls))
    throw internalError();
  if (
    completed.toolCalls.some((call) => !validToolCall(call)) ||
    !callsMatch(streamedCalls, completed.toolCalls)
  )
    throw internalError();
  const usage = usageMetadata(completed);
  let finalText = completed.text;
  if (mode === 'append-only') {
    if (finalText !== text) throw new NativeChatModelError(providerError('unsupported_capability'));
    finalText = '';
  }
  // Buffering lets replacement snapshots and the terminal response settle before emitting one
  // ordinary append-only LangChain message chunk; the caller sees final text, not live progress.
  const remainingCalls =
    mode === 'buffered' || streamedCalls.length === 0 ? completed.toolCalls : [];
  yield chunk(finalText, completed.finishReason, remainingCalls, undefined, usage);
}

function validateOptions(
  provider: LanguageModelProvider,
  options: NativeChatModelCallOptions,
): void {
  const supported = new Set(
    'signal maxConcurrency callbacks tags metadata runName runId configurable recursionLimit maxOutputTokens temperature'.split(
      ' ',
    ),
  );
  if (Object.keys(options).some((key) => !supported.has(key)))
    throw new NativeChatModelError(providerError('unsupported_capability'));
  for (const control of ['maxOutputTokens', 'temperature'] as const) {
    if (options[control] !== undefined && !provider.capabilities.requestControls?.includes(control))
      throw new NativeChatModelError(providerError('unsupported_capability'));
  }
  if (!provider.capabilities.streaming || typeof provider.stream !== 'function')
    throw new NativeChatModelError(providerError('unsupported_capability'));
}

function chunk(
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

function usageMetadata(response: LanguageModelResponse): AIMessageChunk['usage_metadata'] {
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

function validToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== 'object') return false;
  const call = value as ToolCall;
  const validId = typeof call.id === 'string' && !!call.id.trim();
  const validName = typeof call.name === 'string' && !!call.name.trim();
  const validArguments =
    !!call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments);
  return validId && validName && validArguments;
}

function callsMatch(streamed: readonly ToolCall[], completed: readonly ToolCall[]): boolean {
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

function providerError(code: ProviderError['code']): ProviderError {
  return { code, message: '', retryable: false };
}

function internalError(): NativeChatModelError {
  return new NativeChatModelError(providerError('internal_error'));
}

function cancelled(): Error {
  return Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
}
