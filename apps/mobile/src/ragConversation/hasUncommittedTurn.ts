import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { PendingTurn } from './conversationSessionTypes';

/** A settled uncommitted turn needs interruption tracking, unless a save or Stop owns it. */
export function hasUncommittedTurn(
  turn: ReturnType<typeof createConversationTurnRetention> | undefined,
  request: PendingTurn,
  signal: AbortSignal,
): boolean {
  return Boolean(
    turn && !request.committed && !turn.hasPending() && !signal.aborted,
  );
}
