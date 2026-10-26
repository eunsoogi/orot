/** Connect provider-neutral schema plans to the adapter's private invocation boundary. */
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type {
  BaseLanguageModelInput,
  StructuredOutputMethodOptions,
} from '@langchain/core/language_models/base';
import type { ChatResult } from '@langchain/core/outputs';
import { Runnable } from '@langchain/core/runnables';
import type { LanguageModelCapabilities, LanguageModelFinishReason } from '@orot/model-runtime';
import type { NativeChatModelCallOptions } from './chatModel';
import { prepareStructuredOutput, StructuredOutputError } from './structuredOutputSchema';
import type {
  CreateStructuredOutputError,
  StructuredOutputPlan,
  StructuredOutputSchema,
} from './structuredOutputSchema';

export { StructuredOutputError } from './structuredOutputSchema';
export type { StructuredOutputPlan, StructuredOutputSchema } from './structuredOutputSchema';

/** Carry one adapter dispatch's response and parse-relevant metadata. */
export interface NativeGenerationResult {
  readonly result: ChatResult;
  readonly structuredOutput?: unknown;
  readonly finishReason: LanguageModelFinishReason;
  readonly hasToolCalls: boolean;
}

export interface StructuredOutputInvocationResult {
  readonly raw: BaseMessage;
  readonly structuredOutput?: unknown;
  readonly finishReason: LanguageModelFinishReason;
  readonly hasToolCalls: boolean;
}

/** Use an injected adapter callback without importing adapter runtime symbols. */
export type StructuredOutputExecutor = (
  input: BaseLanguageModelInput,
  plan: StructuredOutputPlan,
  options: Partial<NativeChatModelCallOptions>,
) => Promise<StructuredOutputInvocationResult>;

/** Add the fallback JSON contract before user messages without rewriting existing prompt content. */
export function withJsonSchemaInstruction(
  messages: BaseMessage[],
  plan: StructuredOutputPlan,
): BaseMessage[] {
  if (plan.mode !== 'json_prompt') return messages;
  let insertion = messages.findIndex((message) => message._getType() !== 'system');
  if (insertion === -1) insertion = messages.length;
  return [
    ...messages.slice(0, insertion),
    new SystemMessage(plan.instruction),
    ...messages.slice(insertion),
  ];
}

/** Keep cancellation active after provider work while asynchronous schema parsing finishes. */
function throwIfInvocationAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw Object.assign(new Error('Native invocation cancelled.'), { name: 'AbortError' });
}

class PrivateStructuredOutputRunnable<RunOutput extends Record<string, any>> extends Runnable<
  BaseLanguageModelInput,
  RunOutput | { readonly raw: BaseMessage; readonly parsed: RunOutput },
  NativeChatModelCallOptions
> {
  lc_namespace = ['orot', 'langchain', 'structured_output'];

  constructor(
    private readonly execute: (
      input: BaseLanguageModelInput,
      options: Partial<NativeChatModelCallOptions>,
    ) => Promise<RunOutput | { readonly raw: BaseMessage; readonly parsed: RunOutput }>,
  ) {
    super();
  }

  /** Bypass Runnable's callback wrapper because prompts and generated health data are private. */
  async invoke(
    input: BaseLanguageModelInput,
    options: Partial<NativeChatModelCallOptions> = {},
  ): Promise<RunOutput | { readonly raw: BaseMessage; readonly parsed: RunOutput }> {
    return this.execute(input, options);
  }
}

/** Use declared native response formats when available, otherwise validate one JSON response locally. */
export function createStructuredOutputRunnable<RunOutput extends Record<string, any>>(
  capabilities: LanguageModelCapabilities,
  outputSchema: StructuredOutputSchema<RunOutput>,
  config: StructuredOutputMethodOptions<boolean> | undefined,
  execute: StructuredOutputExecutor,
  createError: CreateStructuredOutputError,
  resolveOptions: (
    options: Partial<NativeChatModelCallOptions>,
  ) => Partial<NativeChatModelCallOptions> = (options) => options,
): Runnable<
  BaseLanguageModelInput,
  RunOutput | { readonly raw: BaseMessage; readonly parsed: RunOutput },
  NativeChatModelCallOptions
> {
  const { plan, parse } = prepareStructuredOutput(capabilities, outputSchema, config, createError);
  return new PrivateStructuredOutputRunnable(async (input, options) => {
    // Bound defaults must govern both native work and the later asynchronous parse boundary.
    options = resolveOptions(options);
    const result = await execute(input, plan, options);
    if (result.finishReason !== 'complete' || result.hasToolCalls)
      throw new StructuredOutputError();
    let value: unknown;
    if (plan.mode === 'native' && result.structuredOutput !== undefined) {
      value = result.structuredOutput;
    } else {
      if (typeof result.raw.content !== 'string') throw new StructuredOutputError();
      try {
        value = JSON.parse(result.raw.content) as unknown;
      } catch {
        throw new StructuredOutputError();
      }
    }

    // Schema parsing stays separate from domain checks, but cancellation still spans async parsing.
    throwIfInvocationAborted(options.signal);
    let parsed: RunOutput;
    try {
      parsed = (await parse(value)) as RunOutput;
    } catch (error) {
      throwIfInvocationAborted(options.signal);
      throw error;
    }
    throwIfInvocationAborted(options.signal);
    return config?.includeRaw ? { raw: result.raw, parsed } : parsed;
  });
}
