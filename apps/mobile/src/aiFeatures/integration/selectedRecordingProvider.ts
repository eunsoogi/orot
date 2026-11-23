import {
  providerFailure,
  type LanguageModelProvider,
} from '@orot/model-runtime';

const stale = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'The selected recording changed before dispatch.',
    retryable: false,
  });

/** Keep the native sample and the synchronous ownership check at the selected
 * provider's innermost adapter, not outside later observer/selection awaits. */
export function guardSelectedRecordingProvider(
  provider: LanguageModelProvider,
  protectedCurrent: () => Promise<boolean>,
  current: () => boolean,
): LanguageModelProvider {
  const sample = async () => {
    try {
      return await protectedCurrent();
    } catch {
      return false;
    }
  };
  return {
    ...provider,
    async generate(request, options) {
      if (!(await sample()) || options?.signal?.aborted || !current())
        return stale();
      return provider.generate(request, options);
    },
    ...(provider.stream
      ? {
          async *stream(request, options) {
            if (!(await sample()) || options?.signal?.aborted || !current()) {
              yield stale();
              return;
            }
            yield* provider.stream!(request, options);
          },
        }
      : {}),
  };
}
