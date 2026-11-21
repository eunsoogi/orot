import type {
  ContinuationOpportunity,
  ConversationExecutionAdapter,
} from './conversationExecutionLease';
import type { ConversationLifetimeEntry } from './conversationLifetimeEntry';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';

function requestWork(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
  confirmedForeground = false,
) {
  if (
    !execution?.work ||
    !entry.release?.admitted ||
    entry.waitingForDecision ||
    entry.continuedRequested ||
    entry.continuedDeferred ||
    entry.status ||
    entry.controller.signal.aborted ||
    (!confirmedForeground && execution.currentPhase?.() !== 'active')
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
  entry.continuedDeferred = false;
  entry.continuedRequested = false;
  requestWork(entry, execution);
}

export function revokeContinuedConversationWork(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
) {
  const requested = entry.continuedRequested;
  entry.continuedDeferred = false;
  if (!requested) return;
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

/** A native inactive receipt proves submission never ran. A subsequent
 * foreground event may retry admission, never provider execution. */
function observeContinuedOpportunity(
  entry: ConversationLifetimeEntry,
  event: ContinuationOpportunity,
  execution?: ConversationExecutionAdapter,
) {
  if (
    !entry.release?.admitted ||
    entry.waitingForDecision ||
    entry.status ||
    entry.controller.signal.aborted
  )
    return;
  if (event === 'continued-deferred-inactive') {
    if (!entry.continuedRequested) return;
    entry.continuedRequested = false;
    entry.continuedDeferred = true;
  } else if (event === 'continuation-foreground') {
    if (!entry.continuedDeferred) return;
    entry.continuedDeferred = false;
    requestWork(entry, execution, true);
  } else if (entry.continuedRequested || entry.continuedDeferred) {
    // Scheduler refusal/grant is a real attempt, not a foreground retry permit.
    entry.continuedDeferred = false;
    entry.continuedRequested = true;
  }
}

/** The native request binding is checked by the lease; recheck the UI owner
 * here so an old active lease cannot seek work after a replacement turn. */
export function continuedOpportunityObserver(
  entry: ConversationLifetimeEntry,
  entries: ReadonlyMap<number, ConversationLifetimeEntry>,
  execution?: ConversationExecutionAdapter,
) {
  return (event: ContinuationOpportunity) => {
    if (entries.get(entry.id) === entry)
      observeContinuedOpportunity(entry, event, execution);
  };
}
