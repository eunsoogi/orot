import {
  providerFailure,
  type LanguageModelProvider,
} from '@orot/model-runtime';

const unavailable = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'The conversation model changed before dispatch.',
    retryable: false,
  });

/** An account/model epoch can retire after the late catalog check or while
 * required consent is pending. Only the already-authorized call is guarded.
 */
export function warmConversationProviderGuard(
  provider: LanguageModelProvider,
  current?: () => boolean,
  durable?: () => Promise<boolean>,
): LanguageModelProvider {
  if (!current) return provider;
  const permitted = async () =>
    current() && (!durable || (await durable())) && current();
  return {
    ...provider,
    async generate(request, options) {
      return (await permitted()) && current()
        ? provider.generate(request, options)
        : unavailable();
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            if (!(await permitted()) || !current()) {
              yield unavailable();
              return;
            }
            yield* provider.stream!(request, options);
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
    ...(provider.searchPublicWeb
      ? ({
          async searchPublicWeb(request, options) {
            return (await permitted()) && current()
              ? provider.searchPublicWeb!(request, options)
              : unavailable();
          },
        } satisfies Pick<LanguageModelProvider, 'searchPublicWeb'>)
      : {}),
  };
}
