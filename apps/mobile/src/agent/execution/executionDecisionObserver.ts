const listeners = new WeakMap<AbortSignal, () => void>();

/** This observes only an actual disclosure surface, not cached consent checks or payload data. */
export function observeExecutionDecision(
  signal: AbortSignal,
  listener?: () => void,
) {
  if (!listener) return () => {};
  listeners.set(signal, listener);
  return () => {
    if (listeners.get(signal) === listener) listeners.delete(signal);
  };
}

export function executionNeedsDecision(signal: AbortSignal) {
  if (!signal.aborted) listeners.get(signal)?.();
}
