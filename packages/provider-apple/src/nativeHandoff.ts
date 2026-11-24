import { providerFailure } from '@orot/model-runtime';
import type { AppleGenerationOptions } from './types';

/** Consume proof through request-bearing bridge invocation, after availability and before
 * the first bridge await. This is not a promise of atomicity inside the native runtime. */
export async function runAppleNativeHandoff<T>(options: AppleGenerationOptions, start: () => T) {
  const fence = options.nativeHandoffFence;
  if (!fence) return { value: start() };
  const witness = await fence();
  if (!witness) return;
  try {
    if (options.signal?.aborted || !witness.current()) return;
    return { value: start() };
  } finally {
    witness.dispose();
  }
}

export function refusedAppleHandoff() {
  return providerFailure({
    code: 'provider_unavailable',
    message: 'The selected request changed before native dispatch.',
    retryable: false,
  });
}

/** The native stream is lazy; first pull, not object construction, is the handoff. */
export function beganAppleNativeStream<T>(iterable: AsyncIterable<T>): AsyncIterable<T> {
  const source = iterable[Symbol.asyncIterator]();
  const first = source.next();
  let pending = true;
  return {
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
}
