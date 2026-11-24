import {
  adoptContinuedConversationLease,
  continuedOpportunityObserver,
} from './conversationContinuedWork';
import {
  clearDrainedConversationPause,
  requestOwnedConversationPause,
} from './conversationDeferredPause';
import type { ConversationCheckpointPauseReason } from './conversationCheckpointInterruption';
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
    acceptNativeExpiry?: (id: number) => boolean;
    pauseState?: (id: number, resume?: () => void) => void;
  },
  entries: Map<number, ConversationLifetimeEntry>,
): Promise<boolean> {
  // Persistence can finish after Stop or owner replacement. Never publish stale recovery UI.
  const current = () =>
    entries.get(entry.id) === entry &&
    !entry.status &&
    !entry.controller.signal.aborted;
  if (!input.pauseState || !current()) return false;
  return new Promise(resolve => {
    let settled = false;
    let resuming = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      entry.controller.signal.removeEventListener('abort', aborted);
      if (entries.get(entry.id) === entry) input.pauseState?.(entry.id);
      // Clearing the action is observable and may synchronously replace or stop its owner.
      resolve(result && current());
    };
    const aborted = () => finish(false);
    entry.controller.signal.addEventListener('abort', aborted, { once: true });
    input.pauseState?.(entry.id, () => {
      if (settled || resuming) return;
      if (!current()) {
        finish(false);
        return;
      }
      resuming = true;
      input.pauseState?.(entry.id);
      // UI publication can synchronously stop or replace this owner before lease acquisition.
      if (!current()) {
        finish(false);
        return;
      }
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
            () => requestOwnedConversationPause(entry, entries),
            entry.diagnose,
            () => !current() || input.acceptNativeExpiry?.(entry.id) !== false,
            continuedOpportunityObserver(entry, entries, input.execution),
          );
          if (!current()) release();
          else
            adoptContinuedConversationLease(
              entry,
              release,
              input.execution,
              false,
              current,
            );
        }
        if (!current()) {
          entry.release?.();
          entry.release = undefined;
        }
        finish(current());
      })().catch(() => finish(false));
    });
    if (entry.controller.signal.aborted) finish(false);
  });
}

/** Persist the pause before offering Continue. A Stop that wins during the write
 * owns the short lease until its separate durable interruption fence settles. */
export async function persistConversationPause(
  entry: ConversationLifetimeEntry | undefined,
  reason: ConversationCheckpointPauseReason,
  input: Parameters<typeof waitForWorkflowContinue>[1],
  entries: Map<number, ConversationLifetimeEntry>,
) {
  if (!entry) return false;
  const current = () =>
    entries.get(entry.id) === entry &&
    !entry.status &&
    !entry.controller.signal.aborted;
  if (!current()) return false;
  clearDrainedConversationPause(entry);
  entry.diagnose('workflow-checkpoint-paused', reason);
  await entry.turn.interruptRequest('interrupted', reason).catch(() => {});
  if (!current()) return false;
  entry.release?.();
  entry.release = undefined;
  return waitForWorkflowContinue(entry, input, entries);
}
