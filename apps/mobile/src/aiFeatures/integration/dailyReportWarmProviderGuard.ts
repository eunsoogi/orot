import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';

const unavailable = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'The resumed Daily Report is no longer available.',
    retryable: false,
  });

/** A continued Daily Report owns its child operation signals, not only the
 * Conversation's lifetime. An optional opening can retire while final stays live. */
export function dailyReportWarmProviderGuard(
  provider: LanguageModelProvider,
  current: () => boolean,
  durable: () => Promise<boolean>,
): LanguageModelProvider {
  const live = (signal?: AbortSignal) => !signal?.aborted && current();
  const permitted = async (signal?: AbortSignal) =>
    live(signal) && (await durable()) && live(signal);
  return {
    ...provider,
    async generate(request, options) {
      if (!(await permitted(options?.signal)) || !live(options?.signal))
        return unavailable();
      return provider.generate(request, options);
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            if (!(await permitted(options?.signal)) || !live(options?.signal)) {
              yield unavailable();
              return;
            }
            yield* provider.stream!(request, options);
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
}
