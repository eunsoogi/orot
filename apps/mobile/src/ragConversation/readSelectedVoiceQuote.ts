import type { ConversationSessions } from './conversationSessions';

type Scope = Partial<
  Pick<
    ConversationSessions,
    'getSnapshot' | 'readExplicitPriorVoiceContext' | 'subscribe'
  >
>;

/** A duration-card tap owns one read of observed fragments. Its authority
 * cannot reappear after a synchronous session selection or source change. */
export async function readSelectedVoiceQuote(
  store: Scope,
  target: {
    readonly sessionId: number;
    readonly marker: string;
    readonly revision: number;
    readonly signal: AbortSignal;
  },
) {
  const selectedOwner = () => {
    const snapshot = store.getSnapshot?.();
    const session = snapshot?.sessions.find(
      item => item.id === snapshot.activeId,
    );
    return (
      session?.id === target.sessionId &&
      !session.quarantined &&
      !session.restoring &&
      Boolean(
        session.taskCards?.some(
          card =>
            card.id === target.marker &&
            card.revision === target.revision &&
            card.hasObservedVoiceCaptions,
        ),
      )
    );
  };
  let current = !target.signal.aborted && selectedOwner();
  if (!current || !store.readExplicitPriorVoiceContext || !store.subscribe)
    return undefined;
  const stillCurrent = () => {
    current = current && !target.signal.aborted && selectedOwner();
    return current;
  };
  const release = store.subscribe(stillCurrent);
  try {
    if (!stillCurrent()) return undefined;
    const result = await store.readExplicitPriorVoiceContext({
      session: target.sessionId,
      marker: target.marker,
      signal: target.signal,
      isExplicitSelectionCurrent: stillCurrent,
    });
    return stillCurrent() ? result : undefined;
  } finally {
    release();
  }
}
