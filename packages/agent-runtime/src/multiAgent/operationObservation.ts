/** Observe cancellation without claiming that an already-started operation stopped. */
export type ObservedOperation<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'error' }
  | { readonly kind: 'cancelled' };

export function observeUntilAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<ObservedOperation<T>> {
  if (signal.aborted) {
    // Cancellation wins, but the already-started operation still needs a rejection handler.
    operation.catch(() => undefined);
    return Promise.resolve({ kind: 'cancelled' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ObservedOperation<T>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ kind: 'cancelled' });
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish({ kind: 'value', value }),
      () => finish({ kind: 'error' }),
    );
  });
}
