/** Registers at iteration start and closes the provider iterator immediately on abort. */
export function cancellableStream<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  if (!signal) return source;
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      const cancel = () => {
        iterator.return?.().catch(() => undefined);
      };
      const clean = () => signal.removeEventListener('abort', cancel);
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
      return {
        async next() {
          try {
            const result = await iterator.next();
            if (result.done) clean();
            return result;
          } catch (error) {
            clean();
            throw error;
          }
        },
        async return() {
          clean();
          return iterator.return ? iterator.return() : { done: true as const, value: undefined };
        },
      };
    },
  };
}
