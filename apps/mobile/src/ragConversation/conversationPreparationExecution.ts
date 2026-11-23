import type { ConversationExecutionEvent } from './conversationExecutionLease';

type Owner = Readonly<{
  requestId: string;
  sessionId: string;
  revision: number;
}>;

type Receipt = 'short-lease-admitted' | 'refused' | 'unavailable';
type TerminalEvent = Extract<
  ConversationExecutionEvent,
  { kind: 'expired' | 'protectedData' }
>;

/** A preparation lease carries only local OS time. It cannot establish a model,
 * authorize transmission, or persist a request before protected storage wins. */
export function startConversationPreparationExecution(input: {
  readonly owner: Owner;
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly begin: (requestId: string) => Promise<boolean>;
  readonly subscribe?: (
    receive: (event: ConversationExecutionEvent) => void,
  ) => () => void;
  readonly onPreparationEnd?: (event: TerminalEvent) => void;
  readonly isActive: (requestId: string) => Promise<boolean>;
  readonly end: (requestId: string) => void;
}) {
  // Freeze the witness before either the bridge or caller can yield.
  const owner = { ...input.owner };
  let closed = false;
  let transferred = false;
  let acquired = false;
  let opening = false;
  let ended = false;
  let unsubscribe = () => {};
  let durable: ((event: ConversationExecutionEvent) => void) | undefined;
  let warning:
    | Extract<ConversationExecutionEvent, { kind: 'pause-requested' }>
    | undefined;
  const usable = () =>
    !closed && !transferred && !input.signal.aborted && input.current();
  const release = () => {
    if (ended) return;
    ended = true;
    unsubscribe();
    if (!acquired && !opening) return;
    try {
      input.end(owner.requestId);
    } catch {
      // A bridge rejection must not resurrect the local owner or permit another transfer.
    }
  };
  const close = () => {
    if (closed || transferred) return;
    closed = true;
    warning = undefined;
    input.signal.removeEventListener('abort', close);
    release();
  };
  input.signal.addEventListener('abort', close, { once: true });
  const started: Promise<Receipt> = (async () => {
    try {
      if (!usable()) {
        close();
        return 'unavailable';
      }
      const remove = input.subscribe?.(event => {
        if (
          ended ||
          ('requestId' in event && event.requestId !== owner.requestId)
        )
          return;
        if (durable) {
          durable(event);
          return;
        }
        if (event.kind === 'pause-requested') {
          // No graph exists yet. Only the exact durable relay may accept a
          // warning after checking it against native background authority.
          warning = event.warning ? event : undefined;
        } else if (
          event.kind === 'foreground' ||
          event.kind === 'continuation-foreground' ||
          (event.kind === 'continued' && event.state === 'continued-granted')
        ) {
          warning = undefined;
        } else if (
          event.kind === 'expired' ||
          (event.kind === 'protectedData' && !event.available)
        ) {
          close();
          input.onPreparationEnd?.(event);
        }
      });
      if (remove) {
        if (ended) remove();
        else unsubscribe = remove;
      }
      if (!usable()) return 'unavailable';
      // Call the bridge before awaiting protected model or history reads.
      opening = true;
      acquired = (await input.begin(owner.requestId)) === true;
      opening = false;
      if (!usable()) {
        close();
        return 'unavailable';
      }
      if (acquired) return 'short-lease-admitted';
      close();
      return 'refused';
    } catch {
      close(); // Ending a maybe-created lease on the same serial native queue is safe.
      return 'unavailable';
    }
  })();
  return {
    started,
    close,
    async adopt(
      committed: Owner,
      durableCurrent: () => boolean,
      receive?: (event: ConversationExecutionEvent) => void,
    ) {
      const exact = () =>
        usable() &&
        acquired &&
        committed.requestId === owner.requestId &&
        committed.sessionId === owner.sessionId &&
        committed.revision === owner.revision &&
        durableCurrent() &&
        usable();
      try {
        // Keep the prep abort hook installed during the native ownership check.
        if (!exact() || !(await input.isActive(owner.requestId)) || !exact()) {
          close();
          return null;
        }
      } catch {
        close();
        return null;
      }
      // Owner and receiver change synchronously; no native resubscribe gap.
      durable = receive;
      transferred = true;
      input.signal.removeEventListener('abort', close);
      const queuedWarning = warning;
      warning = undefined;
      if (queuedWarning) durable?.(queuedWarning);
      // The durable lifetime now owns this single release; no second acquisition.
      return release;
    },
  };
}
