import type {
  ConversationLifetimeEntry,
  StopStatus,
} from './conversationLifetimeEntry';
import type { ConversationExecutionAdapter } from './conversationExecutionLease';

/** Revoke continued execution immediately, but retain the ordinary lease until durable cleanup settles. */
export function interruptConversationLifetime(
  entry: ConversationLifetimeEntry,
  status: StopStatus,
  erase: boolean,
  execution: ConversationExecutionAdapter | undefined,
  reportFenceFailure: () => void,
) {
  entry.status = status;
  if (status === 'cancelled') entry.diagnose('user-stop', 'user-stopped');
  try {
    // Native false finishes continued work unsuccessfully, not as a completed answer.
    // It does not release the short storage lease or claim remote abort acknowledgement.
    execution?.work?.(entry.executionId, false);
  } catch {
    // A missing/broken optional bridge must not prevent provider abort or the protected fence.
  }
  // Stop keeps submitted input. Only destructive abandonment erases it, after the initial row exists.
  entry.fence = (async () => {
    await entry.start?.catch(() => {});
    await entry.turn.interruptRequest(
      erase ? 'cancelled' : 'interrupted',
      entry.interruptionReason ??
        (status === 'cancelled' ? 'user-stopped' : 'provider-failed'),
    );
  })().catch(reportFenceFailure);
}
