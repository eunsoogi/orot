import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type BaseMessageLike,
} from '@langchain/core/messages';
import type { ChatResult, LLMResult } from '@langchain/core/outputs';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type { LanguageModelProvider, ProviderError, ProviderErrorCode } from '@orot/model-runtime';
import { toLangChainMessages, toNativeMessages } from './messages';

export interface NativeChatModelCallOptions extends BaseChatModelCallOptions {
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

/** Preserve the provider's closed error classification without exposing its diagnostic payload. */
export class NativeChatModelError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  constructor(error: ProviderError) {
    super(`Native model invocation failed (${error.code}).`);
    this.name = 'NativeChatModelError';
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

function unsupported(): never {
  throw new NativeChatModelError({
    code: 'unsupported_capability',
    message: 'The invocation adapter does not support this option.',
    retryable: false,
  });
}

/** Runnable invocation over an already selected, consent-gated provider. No provider selection,
 * tool binding, streaming strategy, structured-output strategy or consent is created here.
 * Those strategies can extend this class in separate modules without changing the native port. */
export class NativeChatModel extends BaseChatModel<NativeChatModelCallOptions> {
  constructor(protected readonly provider: LanguageModelProvider) {
    super({ cache: false, maxRetries: 0, disableStreaming: true });
  }

  _llmType() {
    return 'orot-native';
  }

  /** BaseChatModel.generate emits raw health messages to callbacks and ambient tracers.
   * Own this boundary so invoke/generatePrompt remain private; provider telemetry stays upstream.
   * No cache or retry wrapper may skip or duplicate an invocation's single provider dispatch. */
  async generate(
    messages: BaseMessageLike[][],
    options?: string[] | Partial<NativeChatModelCallOptions>,
    _callbacks?: Callbacks,
  ): Promise<LLMResult> {
    if (Array.isArray(options)) unsupported();
    const results: ChatResult[] = [];
    for (const input of messages) {
      const converted = NativeChatModel._convertInputToPromptValue(input).toChatMessages();
      results.push(await this._generate(converted, options ?? {}));
    }
    return { generations: results.map((result) => result.generations) };
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    // Reject unsupported requests before dispatch rather than silently dropping model controls.
    const supported = new Set([
      'signal',
      'timeout',
      'maxConcurrency',
      'callbacks',
      'tags',
      'metadata',
      'runName',
      'runId',
      'configurable',
      'recursionLimit',
      'maxOutputTokens',
      'temperature',
    ]);
    if (Object.keys(options).some((key) => !supported.has(key))) unsupported();
    for (const control of ['maxOutputTokens', 'temperature'] as const) {
      if (
        options[control] !== undefined &&
        !this.provider.capabilities.requestControls?.includes(control)
      )
        unsupported();
    }
    // A deadline requires host-owned cancellation; do not race a timeout against live native work.
    if (options.timeout !== undefined) unsupported();
    const signal = options.signal;
    if (signal?.aborted)
      throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
    const request = {
      messages: toNativeMessages(messages).messages,
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
    let result;
    try {
      // Pass the signal through: the provider owns native cancellation and listener cleanup.
      result = await this.provider.generate(request, { signal });
    } catch (error) {
      if (signal?.aborted)
        throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new NativeChatModelError({ code: 'internal_error', message: '', retryable: false });
    }
    if (signal?.aborted)
      throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
    if (!result.ok) throw new NativeChatModelError(result.error);
    const response = result.value;
    const [converted] = toLangChainMessages([
      { role: 'assistant', content: response.text, toolCalls: response.toolCalls },
    ]);
    if (!AIMessage.isInstance(converted)) throw new Error('Expected an assistant response.');
    const message = new AIMessageChunk({
      content: converted.content,
      tool_calls: converted.tool_calls,
      response_metadata: { finish_reason: response.finishReason },
      // The current native response contract carries no usage. Do not infer token counts.
    });
    return { generations: [{ text: response.text, message }] };
  }
}
