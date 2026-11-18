import type { HealthContextReader } from './reader';
import type { HealthContextReport } from './types';

type Operation = { readonly read: HealthContextReader; dispose(): void };
const owners = new WeakMap<
  HealthContextReader,
  (signal?: AbortSignal) => Operation
>();

/** Only the production database reader installs this capability. Generic readers
 * and aliases must retain their original validation and native ownership. */
export function registerHealthContextReadOwner(
  reader: HealthContextReader,
  readWithCache: (
    cache: Map<string, HealthContextReport>,
  ) => HealthContextReader,
) {
  owners.set(reader, operationSignal => {
    const cache = new Map<string, HealthContextReport>();
    const scoped = readWithCache(cache);
    let disposed = false;
    return {
      read: async (...args) => {
        if (disposed) return reader(...args);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        const signals = [args[2], operationSignal].filter(
          (value): value is AbortSignal => value !== undefined,
        );
        for (const signal of signals) {
          if (signal.aborted) cancel();
          signal.addEventListener('abort', cancel, { once: true });
        }
        try {
          return await scoped(args[0], args[1], controller.signal, args[3]);
        } finally {
          for (const signal of signals)
            signal.removeEventListener('abort', cancel);
          // Disposal can overlap a queued transaction. Never retain its late result.
          if (disposed) cache.clear();
        }
      },
      dispose() {
        disposed = true;
        cache.clear();
      },
    };
  });
}

/** Scope only aggregate reuse, not source validity. Every read retains the
 * database generation/cancellation fence; escaped aliases fall back after release. */
export function beginHealthContextReadOperation(
  reader: HealthContextReader,
  signal?: AbortSignal,
): Operation | undefined {
  return owners.get(reader)?.(signal);
}
