import {
  providerFailure,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import type { TypedHeartRateDispatch } from './typedHeartRateReusePolicy';

const unavailable = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'The selected typed heart-rate scope requires fresh approval.',
    retryable: false,
  });

/** Gate the actual request start, including an async generator's first next(). */
export function guardTypedHeartRateProvider(
  provider: LanguageModelProvider,
  authority: TypedHeartRateDispatch,
): LanguageModelProvider {
  const dispatch = async <T>(
    start: () => T,
    signal = new AbortController().signal,
  ): Promise<{ started: T } | undefined> => {
    const grant = authority.active();
    if (!grant) return signal.aborted ? undefined : { started: start() };
    if (grant.spent || signal.aborted || !grant.current()) return;
    grant.spent = true;

    // A protected write after this final proof must invalidate before adapter entry.
    const witness = grant.source.acquire();
    if (!witness) return;
    try {
      if (!(await grant.source.reprove(signal)) || !(await grant.recheck()))
        return;
      if (
        grant.source.confirmDispatch &&
        !(await grant.source.confirmDispatch())
      )
        return;
      if (signal.aborted || !grant.current() || !witness.current()) return;
      // No await between the synchronous source/turn guards and invocation.
      return { started: start() };
    } finally {
      witness.dispose();
    }
  };
  return {
    ...provider,
    async generate(request, options) {
      const result = await dispatch(
        () => provider.generate(request, options),
        options?.signal,
      );
      return result ? result.started : unavailable();
    },
    ...(provider.stream
      ? ({
          async *stream(request, options) {
            const result = await dispatch(() => {
              const stream = provider.stream!(request, options)[
                Symbol.asyncIterator
              ]();
              return { stream, first: stream.next() };
            }, options?.signal);
            if (!result) {
              yield unavailable();
              return;
            }
            const { stream, first } = result.started;
            let finished = false;
            try {
              let event = await first;
              while (!event.done) {
                yield event.value;
                event = await stream.next();
              }
              finished = true;
            } finally {
              if (!finished) await stream.return?.();
            }
          },
        } satisfies Pick<LanguageModelProvider, 'stream'>)
      : {}),
  };
}
