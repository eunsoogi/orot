import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from './conversationExecutionLease';

/** An advisory can ask the exact live graph to checkpoint, never interrupt
 * provider work. Only a native witness for the current background visit
 * is accepted; a fresh visit may rearm a rejected, still-pending warning. */
export function createConversationPauseAdvisory(
  adapter: ConversationExecutionAdapter,
  requestId: string,
  ownsRequest: () => boolean,
  requestPause: () => void,
) {
  let requested = false;
  let advisoryRevision = 0;
  const pending = new Set<string>();
  function drain() {
    if (requested || !ownsRequest()) return;
    requested = true;
    requestPause();
  }
  return {
    receive(
      event: Extract<ConversationExecutionEvent, { kind: 'pause-requested' }>,
    ) {
      if (event.requestId !== requestId || requested || !ownsRequest()) return;
      const { warning } = event;
      if (!warning) {
        // Internal synthetic adapters do not cross the native event decoder.
        if (!adapter.pauseStillCurrent) drain();
        return;
      }
      if (pending.has(warning) || !adapter.pauseStillCurrent) return;
      pending.add(warning);
      const revision = advisoryRevision;
      adapter.pauseStillCurrent(requestId, warning).then(
        current => {
          if (
            revision === advisoryRevision &&
            pending.delete(warning) &&
            current &&
            adapter.currentPhase?.() === 'background'
          )
            drain();
        },
        () => {
          if (revision === advisoryRevision) pending.delete(warning);
        },
      );
    },
    invalidate() {
      advisoryRevision++;
      pending.clear();
    },
  };
}
