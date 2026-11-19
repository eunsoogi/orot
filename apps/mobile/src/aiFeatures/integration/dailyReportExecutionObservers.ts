import type { RagConversationObserver } from '../../ragConversation/conversationObserver';

type Observer = Pick<RagConversationObserver, 'onExecutionState'>;
type State = 'working' | 'local' | 'decision';

/** Shares only observed execution state, never task payloads, consent or pause ownership.
 * A joining lifetime may request its own supported OS lease only after real remote dispatch. */
export function dailyReportExecutionObservers(signal: AbortSignal) {
  const observers = new Map<Observer, () => void>();
  let latest: { state: State; sequence: number } | undefined;
  let sequence = 0;
  let closed = signal.aborted;
  const remove = (observer: Observer) => {
    observers.get(observer)?.();
    observers.delete(observer);
  };
  const dispose = () => {
    closed = true;
    latest = undefined;
    for (const observer of [...observers.keys()]) remove(observer);
    signal.removeEventListener('abort', dispose);
  };
  const deliver = (observer: Observer, value: NonNullable<typeof latest>) => {
    // A callback can publish a newer state, remove another subscriber or end this operation.
    if (
      closed ||
      signal.aborted ||
      latest !== value ||
      !observers.has(observer)
    )
      return;
    try {
      observer.onExecutionState?.(value.state);
    } catch {
      // One detached UI cannot prevent another live owner from observing execution.
    }
  };
  if (!closed) signal.addEventListener('abort', dispose, { once: true });
  return {
    join(observer?: Observer, ownerSignal?: AbortSignal) {
      if (
        !observer?.onExecutionState ||
        closed ||
        signal.aborted ||
        ownerSignal?.aborted ||
        observers.has(observer)
      )
        return;
      const abort = () => remove(observer);
      observers.set(observer, () =>
        ownerSignal?.removeEventListener('abort', abort),
      );
      ownerSignal?.addEventListener('abort', abort, { once: true });
      if (latest) deliver(observer, latest);
    },
    observe(state: State) {
      if (
        closed ||
        signal.aborted ||
        !['working', 'local', 'decision'].includes(state)
      )
        return;
      // A new observation owns its own epoch, even if it repeats a state after reentrancy.
      const value = { state, sequence: ++sequence };
      latest = value;
      for (const observer of [...observers.keys()]) deliver(observer, value);
    },
    dispose,
  };
}
