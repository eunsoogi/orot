import {
  adoptContinuedConversationLease,
  continuedOpportunityObserver,
} from './conversationContinuedWork';
import { requestOwnedConversationPause } from './conversationDeferredPause';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';
import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationInterruptionReason,
} from './conversationExecutionLease';
import type { ConversationLifetimeEntry } from './conversationLifetimeEntry';
import type { WarmExecutionHandoff } from './conversationWarmExecutionHandoff';

/** Rebind the exact early lease's receiver, never another native acquisition. */
export async function adoptConversationLifetimeLease(
  entry: ConversationLifetimeEntry,
  entries: Map<number, ConversationLifetimeEntry>,
  input: {
    execution?: ConversationExecutionAdapter;
    interrupt: (id: number) => void;
    acceptNativeExpiry?: (id: number) => boolean;
  },
  early: WarmExecutionHandoff,
) {
  const { id, controller } = entry;
  const current = () =>
    entries.get(id) === entry && !controller.signal.aborted && !entry.status;
  const interrupt = (reason: ConversationInterruptionReason) => {
    if (!current()) return;
    entry.interruptionReason = reason;
    input.interrupt(id);
  };
  if (!input.execution) return;
  const original = input.execution;
  const opportunity = continuedOpportunityObserver(entry, entries, original);
  const release = await beginConversationExecutionLease(
    early?.adapter(current) ?? original,
    entry.executionId,
    reason =>
      interrupt(
        early && reason === 'lease-denied' ? 'lease-check-failed' : reason,
      ),
    () => requiresConversationDecisionAbort(entry, original),
    () => requestOwnedConversationPause(entry, entries),
    entry.diagnose,
    () => !current() || input.acceptNativeExpiry?.(id) !== false,
    opportunity,
  );
  if (!current()) {
    release();
    return;
  }
  // The native prep already called work; a refusal is not permission to submit again.
  adoptContinuedConversationLease(entry, release, original, Boolean(early));
  const observed = early?.lastState();
  if (observed) opportunity(observed);
}
