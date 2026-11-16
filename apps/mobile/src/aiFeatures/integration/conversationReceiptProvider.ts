import type {
  LanguageModelExecutionOptions,
  LanguageModelProvider,
  LanguageModelResponse,
} from '@orot/model-runtime';

export type ConversationProviderReceipt = 'accepted' | 'response_started';

/** A request-scoped observer of actual provider results, not dispatch or local progress.
 * Output confirms a response began, not comprehension or a validated final answer.
 * Public web search is deliberately left untouched: its receipt is not a chat receipt.
 */
export function conversationReceiptProvider(
  provider: LanguageModelProvider,
  observe?: (receipt: ConversationProviderReceipt) => void,
): LanguageModelProvider {
  if (!observe) return provider;
  let accepted = false;
  let responding = false;
  const report = (hasOutput: boolean, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const receipt = hasOutput ? 'response_started' : 'accepted';
    if (responding || (accepted && !hasOutput)) return;
    accepted = true;
    responding ||= hasOutput;
    try {
      observe(receipt);
    } catch {
      /* Display observation cannot alter provider behavior. */
    }
  };
  const responseOptions = (
    options: LanguageModelExecutionOptions | undefined,
    live: () => boolean,
  ): LanguageModelExecutionOptions => ({
    ...options,
    onResponseStarted() {
      if (!live() || options?.signal?.aborted) return;
      report(true, options?.signal);
      try {
        options?.onResponseStarted?.();
      } catch {
        /* Observation cannot fail generation. */
      }
    },
  });
  const hasOutput = (response: LanguageModelResponse) =>
    Boolean(response.text.trim() || response.toolCalls.length);
  return {
    ...provider,
    async generate(request, options) {
      let live = true;
      try {
        const result = await provider.generate(
          request,
          responseOptions(options, () => live),
        );
        if (result.ok) report(hasOutput(result.value), options?.signal);
        return result;
      } finally {
        live = false;
      }
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            let live = true;
            try {
              for await (const result of provider.stream!(
                request,
                responseOptions(options, () => live),
              )) {
                if (result.ok) {
                  const event = result.value;
                  if (event.type === 'completed')
                    report(hasOutput(event.response), options?.signal);
                  else if (event.type === 'tool_call' || event.text.trim())
                    report(true, options?.signal);
                }
                yield result;
              }
            } finally {
              live = false;
            }
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
}
