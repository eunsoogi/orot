import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';

const staleHistory = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'Conversation history changed before dispatch.',
    retryable: false,
  });

/** Recheck retained lineage at each provider dispatch, after runtime consent and tool waits. */
export function guardConversationHistoryProvider(
  provider: LanguageModelProvider,
  isCurrent: () => Promise<boolean> | boolean,
): LanguageModelProvider {
  const allowed = async (signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    try {
      return (await isCurrent()) && !signal?.aborted;
    } catch {
      return false;
    }
  };
  return {
    ...provider,
    async generate(request, options) {
      if (!(await allowed(options?.signal))) return staleHistory();
      return provider.generate(request, options);
    },
    ...(provider.stream
      ? {
          async *stream(request, options) {
            if (!(await allowed(options?.signal))) {
              yield staleHistory();
              return;
            }
            yield* provider.stream!(request, options);
          },
        }
      : {}),
  };
}

/** Leave provider identity and behavior untouched when no retained lineage was admitted. */
export function guardHistory<T extends { provider: LanguageModelProvider }>(
  execution: T,
  isCurrent: () => Promise<boolean> | boolean,
  hasHistory: boolean,
): T {
  return hasHistory
    ? {
        ...execution,
        provider: guardConversationHistoryProvider(
          execution.provider,
          isCurrent,
        ),
      }
    : execution;
}
