export type ConversationExecutionEvent =
  | { readonly kind: 'expired'; readonly requestId: string }
  | { readonly kind: 'foreground' }
  | { readonly kind: 'protectedData'; readonly available: boolean };

export interface ConversationExecutionAdapter {
  begin(requestId: string): Promise<boolean>;
  end(requestId: string): void;
  isActive(requestId: string): Promise<boolean>;
  protectedDataAvailable(): Promise<boolean | null>;
  subscribe(listener: (event: ConversationExecutionEvent) => void): () => void;
}

/** Owns one bounded iOS lease and fences events that arrive after its request ends. */
export async function beginConversationExecutionLease(
  adapter: ConversationExecutionAdapter,
  requestId: string,
  interrupt: (reason: 'expired' | 'protected-data') => void,
) {
  let closed = false;
  let interrupted = false;
  let acquired = false;
  const notify = (reason: 'expired' | 'protected-data') => {
    if (closed || interrupted) return;
    interrupted = true;
    interrupt(reason);
  };
  const unsubscribe = adapter.subscribe(event => {
    if (event.kind === 'expired' && event.requestId === requestId)
      notify('expired');
    if (event.kind === 'protectedData' && !event.available)
      notify('protected-data');
    // Recheck after foregrounding in case suspension delayed the expiration event.
    if (event.kind === 'foreground' && acquired)
      adapter
        .protectedDataAvailable()
        .then(async available => {
          if (available === false) notify('protected-data');
          else if (!(await adapter.isActive(requestId))) notify('expired');
        })
        .catch(() => notify('expired'));
  });
  try {
    if ((await adapter.protectedDataAvailable()) === false)
      notify('protected-data');
    if (!interrupted) {
      acquired = await adapter.begin(requestId);
      if (!acquired) notify('expired');
      else if ((await adapter.protectedDataAvailable()) === false)
        notify('protected-data');
      else if (!(await adapter.isActive(requestId))) notify('expired');
    }
  } catch {
    notify('expired');
  }
  return () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (acquired) adapter.end(requestId);
  };
}
