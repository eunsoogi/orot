import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import type { ConversationLifetimeEntry } from './conversationLifetimeEntry';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';

function requestWork(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
) {
  if (
    !execution?.work ||
    !entry.release?.admitted ||
    entry.waitingForDecision ||
    entry.continuedRequested ||
    entry.status ||
    entry.controller.signal.aborted ||
    execution.currentPhase?.() !== 'active'
  )
    return;
  // Ask for local OS execution of the durable owner's work, not consent or dispatch.
  entry.continuedRequested = true;
  try {
    execution.work(entry.executionId, true);
  } catch {
    // Optional continued work never invalidates the ordinary lease.
  }
}

export function adoptContinuedConversationLease(
  entry: ConversationLifetimeEntry,
  release: NonNullable<ConversationLifetimeEntry['release']>,
  execution?: ConversationExecutionAdapter,
) {
  entry.release = release;
  entry.continuedRequested = false;
  requestWork(entry, execution);
}

export function revokeContinuedConversationWork(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
) {
  if (!entry.continuedRequested) return;
  entry.continuedRequested = false;
  try {
    execution?.work?.(entry.executionId, false);
  } catch {
    // A bridge failure must not suppress the decision or its interruption.
  }
}

export function observeContinuedConversationActivity(
  entry: ConversationLifetimeEntry,
  state: 'working' | 'local' | 'decision',
  input: {
    execution?: ConversationExecutionAdapter;
    interrupt: (id: number) => void;
  },
) {
  entry.waitingForDecision = state === 'decision' || !!entry.resumableApproval;
  if (entry.waitingForDecision) {
    revokeContinuedConversationWork(entry, input.execution);
    if (
      requiresConversationDecisionAbort(entry, input.execution) &&
      input.execution?.currentPhase?.() === 'background'
    ) {
      entry.interruptionReason = 'decision-required';
      input.interrupt(entry.id);
    }
  } else requestWork(entry, input.execution);
}
