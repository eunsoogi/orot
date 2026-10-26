import { validateGenerationOptions } from './chatOptions';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage, type BaseMessageLike } from '@langchain/core/messages';
import type {
  BaseLanguageModelInput,
  StructuredOutputMethodOptions,
} from '@langchain/core/language_models/base';
import type { Runnable } from '@langchain/core/runnables';
import type { ChatResult, LLMResult } from '@langchain/core/outputs';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import type {
  LanguageModelProvider,
  ProviderErrorCode,
  StructuredOutputFormat,
  TelemetryOutcome,
} from '@orot/model-runtime';
import { toLangChainMessages, toNativeMessages } from './messages';
import {
  NativeChatModelError,
  unsupportedNativeCallOption as unsupported,
} from './chatModelSupport';
import type { NativeChatModelCallOptions } from './chatModelSupport';
import { createCallbackTelemetrySink } from './telemetryCallbacks';
import {
  createStructuredOutputRunnable,
  withJsonSchemaInstruction,
  type NativeGenerationResult,
  type StructuredOutputInvocationResult,
  type StructuredOutputPlan,
  type StructuredOutputSchema,
} from './structuredOutput';

export { NativeChatModelError };
export type { NativeChatModelCallOptions };

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

  /* eslint-disable no-dupe-class-members -- These overloads preserve LangChain's includeRaw result inference. */
  /** Route LangChain's standard API to this provider's declared format capability or JSON fallback.
   * The returned runnable uses the private call path so prompts and results never enter callbacks. */
  override withStructuredOutput<RunOutput extends Record<string, any> = Record<string, any>>(
    outputSchema: StructuredOutputSchema<RunOutput>,
    config?: StructuredOutputMethodOptions<false>,
  ): Runnable<BaseLanguageModelInput, RunOutput>;
  override withStructuredOutput<RunOutput extends Record<string, any> = Record<string, any>>(
    outputSchema: StructuredOutputSchema<RunOutput>,
    config: StructuredOutputMethodOptions<true>,
  ): Runnable<BaseLanguageModelInput, { raw: BaseMessage; parsed: RunOutput }>;
  override withStructuredOutput<RunOutput extends Record<string, any> = Record<string, any>>(
    outputSchema: StructuredOutputSchema<RunOutput>,
    config?: StructuredOutputMethodOptions<boolean>,
  ): Runnable<BaseLanguageModelInput, RunOutput | { raw: BaseMessage; parsed: RunOutput }> {
    return createStructuredOutputRunnable<RunOutput>(
      this.provider.capabilities,
      outputSchema,
      config,
      (input, plan, options) => this.invokeStructuredOutput(input, plan, options),
      (code) =>
        new NativeChatModelError({
          code,
          message: 'Unsupported structured-output request.',
          retryable: false,
        }),
      (options) => this.resolveInvocationOptions(options as this['ParsedCallOptions']),
    ) as Runnable<BaseLanguageModelInput, RunOutput | { raw: BaseMessage; parsed: RunOutput }>;
  }
  /* eslint-enable no-dupe-class-members */

  /** Keep raw messages and ambient tracers private while allowing opted-in metadata callbacks.
   * No cache or retry wrapper may skip or duplicate the provider's single dispatch. */
  async generate(
    messages: BaseMessageLike[][],
    options?: string[] | Partial<NativeChatModelCallOptions>,
    callbacks?: Callbacks,
  ): Promise<LLMResult> {
    if (Array.isArray(options)) unsupported();
    const callOptions = {
      ...(options ?? {}),
      ...(callbacks === undefined ? {} : { callbacks }),
    };
    const results: ChatResult[] = [];
    for (const input of messages) {
      const converted = NativeChatModel._convertInputToPromptValue(input).toChatMessages();
      results.push(await this._generate(converted, callOptions));
    }
    return { generations: results.map((result) => result.generations) };
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    return (await this.generateNative(messages, options)).result;
  }

  /** Strategy hook shared by invoke, structured output and stream; never dispatches by itself. */
  protected resolveInvocationOptions(options: this['ParsedCallOptions']) {
    return options;
  }

  protected prepareInvocation(options: this['ParsedCallOptions']) {
    return { provider: this.provider, options };
  }

  private async invokeStructuredOutput(
    input: BaseLanguageModelInput,
    plan: StructuredOutputPlan,
    options: Partial<NativeChatModelCallOptions>,
  ): Promise<StructuredOutputInvocationResult> {
    const converted = NativeChatModel._convertInputToPromptValue(input).toChatMessages();
    const messages = withJsonSchemaInstruction(converted, plan);
    const generated = await this.generateNative(
      messages,
      options as this['ParsedCallOptions'],
      plan.mode === 'native' ? plan.format : undefined,
    );
    const [generation] = generated.result.generations;
    if (!generation || !AIMessage.isInstance(generation.message)) {
      throw new NativeChatModelError({ code: 'internal_error', message: '', retryable: false });
    }
    return {
      raw: generation.message,
      ...(generated.structuredOutput === undefined
        ? {}
        : { structuredOutput: generated.structuredOutput }),
      finishReason: generated.finishReason,
      hasToolCalls: generated.hasToolCalls,
    };
  }

  /** Keep the only native dispatch path shared by plain and structured calls. */
  private async generateNative(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    responseFormat?: StructuredOutputFormat,
  ): Promise<NativeGenerationResult> {
    options = this.resolveInvocationOptions(options);
    responseFormat ??= options.responseFormat;
    const prepared = this.prepareInvocation(options);
    const provider = prepared.provider;
    // LangChain removes callbacks into RunnableConfig; the public generate override carries its
    // explicit callback argument back here only for this safe custom-event boundary.
    const telemetryOptions = prepared.options as this['ParsedCallOptions'] &
      Pick<NativeChatModelCallOptions, 'callbacks'>;
    const { externalTelemetryEnabled, callbacks, ...providerOptions } = telemetryOptions;
    if (externalTelemetryEnabled !== undefined && typeof externalTelemetryEnabled !== 'boolean')
      unsupported();
    options = providerOptions;
    validateGenerationOptions(provider, options, responseFormat, unsupported);
    const signal = options.signal;
    if (signal?.aborted)
      throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
    const telemetry = createCallbackTelemetrySink({
      enabled: externalTelemetryEnabled,
      callbacks,
    });
    const request = {
      messages: toNativeMessages(messages).messages,
      ...(responseFormat === undefined ? {} : { responseFormat }),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    };
    const startedAt = Date.now();
    let outcome: TelemetryOutcome = 'success';
    let errorCode: ProviderErrorCode | undefined;
    try {
      let result;
      try {
        // Pass the signal through: the provider owns native cancellation and listener cleanup.
        result = await provider.generate(request, { signal });
      } catch (error) {
        if (signal?.aborted)
          throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
        if (error instanceof Error && error.name === 'AbortError') throw error;
        if (error instanceof NativeChatModelError) throw error;
        throw new NativeChatModelError({ code: 'internal_error', message: '', retryable: false });
      }
      if (signal?.aborted)
        throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
      if (!result.ok) throw new NativeChatModelError(result.error);
      const response = result.value;
      const usage = response.usage ?? undefined;
      if (
        usage !== undefined &&
        (typeof usage !== 'object' ||
          Array.isArray(usage) ||
          ![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
            (count) => Number.isSafeInteger(count) && count >= 0,
          ))
      ) {
        throw new NativeChatModelError({ code: 'internal_error', message: '', retryable: false });
      }
      const [converted] = toLangChainMessages([
        { role: 'assistant', content: response.text, toolCalls: response.toolCalls },
      ]);
      if (!AIMessage.isInstance(converted)) throw new Error('Expected an assistant response.');
      // Complete replies must be reusable as history; partial chunks remain rejected on input.
      const message = new AIMessage({
        content: converted.content,
        tool_calls: converted.tool_calls,
        response_metadata: { finish_reason: response.finishReason },
        // Preserve provider totals verbatim. A missing usage object is not a zero-token response.
        ...(usage === undefined
          ? {}
          : {
              usage_metadata: {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                total_tokens: usage.totalTokens,
              },
            }),
      });
      return {
        result: { generations: [{ text: response.text, message }] },
        ...(response.structuredOutput === undefined
          ? {}
          : { structuredOutput: response.structuredOutput }),
        finishReason: response.finishReason,
        hasToolCalls: response.toolCalls.length > 0,
      };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        outcome = 'cancelled';
      } else {
        outcome = 'error';
        errorCode = error instanceof NativeChatModelError ? error.code : 'internal_error';
      }
      throw error;
    } finally {
      telemetry.record({
        operation: 'language-model.generate',
        outcome,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(outcome === 'error' ? { errorCode: errorCode ?? 'internal_error' } : {}),
      });
    }
  }
}
