import { confirmHistorySave } from './confirmHistorySave';
import type { ConversationSessionOptions } from './conversationSessionTypes';
import type { createConversationTurnRetention } from './conversationTurnRetention';

/** These local identities bind a sender to its protected request, not its UI bubble. */
export function requestIdentityObserver(
  retention: ConversationSessionOptions['retention'],
  turn: ReturnType<typeof createConversationTurnRetention> | undefined,
  id: number,
) {
  const session = retention?.activeLease(id);
  return session && turn
    ? {
        retentionSession: session,
        retentionRequestId: turn.toolMessageId,
        confirmHistorySave,
      }
    : {};
}

/** A stale handle cannot cancel a newer controller in the same conversation. */
export function bindRequestCancel(
  controllers: Map<number, AbortController>,
  id: number,
  controller: AbortController,
  cancel: (id: number) => void,
) {
  return () => {
    if (controllers.get(id) !== controller || controller.signal.aborted)
      return false;
    cancel(id);
    return true;
  };
}
