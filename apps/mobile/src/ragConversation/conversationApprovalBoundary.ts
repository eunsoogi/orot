import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import type { ConversationLifetimeEntry } from './conversationRequestLifetime';

/** Only the runtime's journaled, pre-dispatch approval signal permits a cooperative pause. */
export function requiresConversationDecisionAbort(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
): boolean {
  if (!entry.waitingForDecision) return false;
  if (
    entry.resumableApproval &&
    entry.requestPause &&
    !entry.controller.signal.aborted
  ) {
    if (execution?.currentPhase?.() === 'background') entry.requestPause();
    return false;
  }
  return true;
}
