import type { LanguageModelProvider } from '@orot/model-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';

/** Wrap only real model calls, inside the selected model's final owner check.
 * Public-search transports and receipt/authorization preflight do not enter here. */
export function observeConversationProviderExecution(
  provider: LanguageModelProvider,
  start?: RagConversationObserver['onProviderExecution'],
): LanguageModelProvider {
  if (!start) return provider;
  const begin = (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    try {
      return start(signal);
    } catch {
      // A status observer cannot grant or interrupt inference.
    }
  };
  const end = (finish?: () => void) => {
    try {
      finish?.();
    } catch {
      // Do not mask the genuine provider result or failure.
    }
  };
  return {
    ...provider,
    async generate(request, options) {
      const finish = begin(options?.signal);
      try {
        return await provider.generate(request, options);
      } finally {
        end(finish);
      }
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            const finish = begin(options?.signal);
            try {
              yield* provider.stream!(request, options);
            } finally {
              end(finish);
            }
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
}
