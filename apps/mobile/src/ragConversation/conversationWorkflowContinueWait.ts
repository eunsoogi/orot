import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import { beginConversationExecutionLease } from './conversationExecutionLease';
import type { ConversationLifetimeEntry } from './conversationRequestLifetime';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';
/** Abort/deletion settles the pending action; only an explicit tap reacquires execution time. */
export async function waitForWorkflowContinue(
  entry: ConversationLifetimeEntry,
  input: {
    execution?: ConversationExecutionAdapter;
    interrupt: (id: number) => void;
    pauseState?: (id: number, resume?: () => void) => void;
  },
  entries: Map<number, ConversationLifetimeEntry>,
): Promise<boolean> {
  if (!input.pauseState) return false;
  return new Promise(resolve => {
    let settled = false;
    let resuming = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      entry.controller.signal.removeEventListener('abort', aborted);
      if (entries.get(entry.id) === entry) input.pauseState?.(entry.id);
      resolve(result);
    };
    const aborted = () => finish(false);
    entry.controller.signal.addEventListener('abort', aborted, { once: true });
    input.pauseState?.(entry.id, () => {
      if (
        settled ||
        resuming ||
        entries.get(entry.id) !== entry ||
        entry.controller.signal.aborted
      )
        return;
      resuming = true;
      input.pauseState?.(entry.id);
      (async () => {
        entry.executionId = `${entry.leasePrefix ?? `${entry.turn.toolMessageId}:lease:${entry.id}`}:${++entry.leaseAttempt}`;
        if (input.execution) {
          const release = await beginConversationExecutionLease(
            input.execution,
            entry.executionId,
            reason => {
              if (
                entries.get(entry.id) !== entry ||
                entry.controller.signal.aborted ||
                entry.status
              )
                return;
              entry.interruptionReason = reason;
              input.interrupt(entry.id);
            },
            () => requiresConversationDecisionAbort(entry, input.execution),
            () => entry.requestPause?.(),
          );
          if (
            entries.get(entry.id) !== entry ||
            entry.controller.signal.aborted ||
            entry.status
          )
            release();
          else entry.release = release;
        }
        if (
          entry.controller.signal.aborted ||
          entries.get(entry.id) !== entry
        ) {
          entry.release?.();
          entry.release = undefined;
        }
        finish(
          !entry.controller.signal.aborted && entries.get(entry.id) === entry,
        );
      })().catch(() => finish(false));
    });
    if (entry.controller.signal.aborted) finish(false);
  });
}
