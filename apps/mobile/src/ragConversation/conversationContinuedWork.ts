import { createConversationBackgroundStatus } from './conversationBackgroundStatus';
import type { ConversationGraphBackgroundStatus } from './conversationObserver';
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
    entry.continuedRefused === entry.executionId ||
    entry.status ||
    entry.controller.signal.aborted ||
    (!confirmedForeground && execution.currentPhase?.() !== 'active')
  )
    return;
  // Ask for local OS execution of the durable owner's work, not consent or dispatch.
  entry.continuedRequested = true;
  try {
    execution.work(entry.executionId, true);
    entry.backgroundStatus?.checkpointed();
  } catch {
    // Optional continued work never invalidates the ordinary lease.
  }
}

export function adoptContinuedConversationLease(
  entry: ConversationLifetimeEntry,
  release: NonNullable<ConversationLifetimeEntry['release']>,
  execution?: ConversationExecutionAdapter,
  alreadyRequested = false,
  current = () => true,
) {
  const executionId = entry.executionId;
  entry.backgroundStatus?.close();
  const reportStatus = execution?.reportStatus;
  const status =
    reportStatus &&
    createConversationBackgroundStatus({
      signal: entry.controller.signal,
      current: () =>
        current() &&
        entry.executionId === executionId &&
        release.admitted &&
        entry.continuedRequested === true &&
        entry.continuedRefused !== executionId &&
        !entry.waitingForDecision,
      report: stage => reportStatus.call(execution, executionId, stage),
    });
  entry.backgroundStatus = status;
  entry.release = Object.assign(
    () => {
      status?.close();
      release();
    },
    { admitted: release.admitted },
  );
  entry.continuedDeferred = false;
  entry.continuedRequested = alreadyRequested;
  if (alreadyRequested) status?.checkpointed();
  else requestWork(entry, execution);
}

export function revokeContinuedConversationWork(
  entry: ConversationLifetimeEntry,
  execution?: ConversationExecutionAdapter,
) {
  entry.backgroundStatus?.suspend();
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
    entry.status ||
    entry.controller.signal.aborted
  )
    return;
  // Real scheduler refusal survives revocation for approval and any later
  // work notification. A new explicit lease has a different execution ID.
  if (event === 'continued-refused') {
    entry.continuedRefused = entry.executionId;
    entry.backgroundStatus?.suspend();
    entry.continuedDeferred = false;
    return;
  }
  if (entry.waitingForDecision) return;
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

/** Bind once to the admitted lease, not the mutable entry reused by explicit continuation. */
function continuedStatusObserver(
  entry?: ConversationLifetimeEntry,
): ConversationGraphBackgroundStatus {
  const reporter = entry?.backgroundStatus;
  if (!reporter) return {};
  return {
    onProviderExecution: reporter.beginProvider,
    onBackgroundTool: reporter.tool,
    onAcceptedSearch: reporter.acceptedTool,
  };
}

/** Closing the replaced status owner never releases or broadens its execution lease. */
export function createContinuedRequestOwners() {
  class Entries extends Map<number, ConversationLifetimeEntry> {
    override set(id: number, entry: ConversationLifetimeEntry) {
      this.get(id)?.backgroundStatus?.close();
      return super.set(id, entry);
    }
  }
  const entries = new Entries();
  const owners = new WeakMap<AbortController, ConversationLifetimeEntry>();
  return {
    entries,
    owners,
    own(entry: ConversationLifetimeEntry) {
      entries.set(entry.id, entry);
      owners.set(entry.controller, entry);
    },
    statusObserver(current: () => ConversationLifetimeEntry | undefined) {
      const bind = () => continuedStatusObserver(current());
      return { ...bind(), backgroundStatusForLease: bind };
    },
  };
}
