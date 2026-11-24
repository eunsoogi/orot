import {
  APPLE_PROVIDER_ID,
  APPLE_PCC_PROVIDER_ID,
  AppleFoundationModelsProvider,
} from '@orot/provider-apple';
import {
  providerFailure,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import type {
  HoldRecordingTime,
  RecordingTimeWitness,
} from './selectedRecordingTimestampProof';

const stale = () =>
  providerFailure({
    code: 'provider_unavailable',
    message: 'The selected recording changed before dispatch.',
    retryable: false,
  });

/** Keep the source's read witness and a fresh native sample at the innermost
 * synchronous adapter handoff. This cannot make an external network send atomic. */
export function guardSelectedRecordingProvider(
  provider: LanguageModelProvider,
  protectedCurrent: () => Promise<boolean>,
  current: () => boolean,
  holdTimestamp?: HoldRecordingTime,
): LanguageModelProvider {
  const sample = async () => {
    let witness: RecordingTimeWitness | undefined;
    try {
      if (holdTimestamp) witness = await holdTimestamp();
      if ((holdTimestamp && !witness) || !(await protectedCurrent())) {
        witness?.dispose();
        return;
      }
      return { witness };
    } catch {
      witness?.dispose();
      return;
    }
  };
  if (
    holdTimestamp &&
    (provider.id === APPLE_PROVIDER_ID || provider.id === APPLE_PCC_PROVIDER_ID)
  ) {
    // A wrapped Apple object that cannot honor the innermost fence is not safe to use here.
    if (!(provider instanceof AppleFoundationModelsProvider))
      return {
        ...provider,
        generate: async () => stale(),
        async *stream() {
          yield stale();
        },
      };
    const fence = async () => {
      const admitted = await sample();
      if (!admitted?.witness) return;
      const witness = admitted.witness;
      return {
        current: () => current() && witness.current(),
        dispose: () => witness.dispose(),
      };
    };
    return {
      ...provider,
      generate: (request, options) =>
        provider.generate(request, { ...options, nativeHandoffFence: fence }),
      stream: (request, options) =>
        provider.stream(request, { ...options, nativeHandoffFence: fence }),
    };
  }
  return {
    ...provider,
    async generate(request, options) {
      const admitted = await sample();
      try {
        if (
          !admitted ||
          options?.signal?.aborted ||
          !current() ||
          admitted.witness?.current() === false
        )
          return stale();
        return provider.generate(request, options);
      } finally {
        admitted?.witness?.dispose();
      }
    },
    ...(provider.stream
      ? {
          async *stream(request, options) {
            const admitted = await sample();
            let started;
            try {
              if (
                admitted &&
                !options?.signal?.aborted &&
                current() &&
                admitted.witness?.current() !== false
              ) {
                const source = provider.stream!(request, options)[
                  Symbol.asyncIterator
                ]();
                started = { source, first: source.next() };
              }
            } finally {
              admitted?.witness?.dispose();
            }
            if (!started) {
              yield stale();
              return;
            }
            const { source, first } = started;
            let pending = true;
            yield* {
              [Symbol.asyncIterator]: () => ({
                next(value?: unknown) {
                  if (!pending) return source.next(value as never);
                  pending = false;
                  return first;
                },
                return: source.return?.bind(source),
                throw: source.throw?.bind(source),
              }),
            };
          },
        }
      : {}),
  };
}
