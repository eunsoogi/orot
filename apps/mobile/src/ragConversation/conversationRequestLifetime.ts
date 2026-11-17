import {
  requestOwnedConversationPause,
  clearDrainedConversationPause,
  registerConversationPause,
} from './conversationDeferredPause';
import { interruptConversationLifetime } from './conversationLifetimeInterruption';
import { createExecutionDiagnostics } from './conversationExecutionDiagnostics';
import { waitForWorkflowContinue } from './conversationWorkflowContinueWait';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';
import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import { beginConversationExecutionLease } from './conversationExecutionLease';
import type {
  ConversationLifetimeEntry,
  Turn,
  StopStatus,
} from './conversationLifetimeEntry';
export type { ConversationLifetimeEntry } from './conversationLifetimeEntry';
/** Binds the checkpoint and bounded OS lease to the same request, including stop races. */
export function createConversationRequestLifetime(input: {
  execution?: ConversationExecutionAdapter;
  interrupt: (id: number) => void;
  reportFenceFailure: (id: number) => void;
  pauseState?: (id: number, resume?: () => void) => void;
}) {
  const entries = new Map<number, ConversationLifetimeEntry>();
  const owners = new WeakMap<AbortController, ConversationLifetimeEntry>();
  async function attach(
    id: number,
    controller: AbortController,
    turn: Turn,
    prefix: string,
    start: () => Promise<void>,
    exclusive = false,
  ) {
    // New turns may supersede an old UI owner; cold adoption must never displace a live request.
    if (
      (exclusive && entries.has(id)) ||
      owners.has(controller) ||
      controller.signal.aborted
    )
      throw new Error('Conversation lifetime already owned or cancelled.');
    const entry: ConversationLifetimeEntry = {
      id,
      controller,
      turn,
      leaseAttempt: 1,
      executionId: `${prefix}:1`,
      leasePrefix: prefix,
      diagnose: createExecutionDiagnostics(
        input.execution?.bridgeAvailable,
        () => input.execution?.currentPhase?.() ?? 'unknown',
      ),
    };
    entries.set(id, entry);
    owners.set(controller, entry);
    entry.start = start();
    await entry.start;
    if (controller.signal.aborted || entries.get(id) !== entry) return;
    if (input.execution) {
      const release = await beginConversationExecutionLease(
        input.execution,
        entry.executionId,
        reason => {
          if (entries.get(id) === entry && !controller.signal.aborted) {
            entry.interruptionReason = reason;
            input.interrupt(id);
          }
        },
        () => requiresConversationDecisionAbort(entry, input.execution),
        () => requestOwnedConversationPause(entry, entries),
        entry.diagnose,
      );
      if (
        controller.signal.aborted ||
        entries.get(id) !== entry ||
        entry.status
      )
        release();
      else entry.release = release;
    }
  }
  return {
    start(
      id: number,
      controller: AbortController,
      turn: Turn,
      question: string,
      submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput,
    ) {
      return attach(
        id,
        controller,
        turn,
        `${turn.toolMessageId}:lease:${id}`,
        () => turn.startRequest(question, controller.signal, submittedInput),
      );
    },
    /** Adopt a cold attempt's OS lease without creating or resubmitting its protected request. */
    resume(
      id: number,
      controller: AbortController,
      turn: Turn,
      attempt: number,
    ) {
      if (!Number.isSafeInteger(attempt) || attempt < 1)
        return Promise.reject(new Error('Invalid cold continuation attempt.'));
      return attach(
        id,
        controller,
        turn,
        `${turn.toolMessageId}:cold:${id}:${attempt}`,
        async () => {},
        true,
      );
    },
    executionObserver(controller: AbortController) {
      return {
        onApprovalWait: (waiting: boolean) => {
          const entry = owners.get(controller);
          if (
            !entry ||
            entries.get(entry.id) !== entry ||
            controller.signal.aborted
          )
            return;
          entry.resumableApproval = waiting;
          if (waiting) {
            entry.waitingForDecision = true;
            requiresConversationDecisionAbort(entry, input.execution);
          } else entry.waitingForDecision = false;
        },
        onWorkflowPauseController: (requestPause: () => void) =>
          registerConversationPause(
            owners.get(controller),
            entries,
            requestPause,
          ),
        onWorkflowPaused: async (
          reason: 'expired' | 'decision-required' = 'expired',
        ) => {
          const entry = owners.get(controller);
          if (
            !entry ||
            entries.get(entry.id) !== entry ||
            controller.signal.aborted
          )
            return false;
          clearDrainedConversationPause(entry);
          // The graph boundary is already durable; reuse the existing generic notification policy.
          await entry.turn
            .interruptRequest('interrupted', reason)
            .catch(() => {});
          entry.release?.();
          entry.release = undefined;
          return waitForWorkflowContinue(entry, input, entries);
        },
        onExecutionState: (state: 'working' | 'local' | 'decision') => {
          const entry = owners.get(controller);
          if (
            !entry ||
            entry.status ||
            entries.get(entry.id) !== entry ||
            controller.signal.aborted
          )
            return;
          entry.waitingForDecision = state === 'decision';
          input.execution?.work?.(entry.executionId, state === 'working');
          if (
            state === 'decision' &&
            requiresConversationDecisionAbort(entry, input.execution) &&
            input.execution?.currentPhase?.() === 'background'
          ) {
            entry.interruptionReason = 'decision-required';
            input.interrupt(entry.id);
          }
        },
      };
    },
    /** Record only a closed result category for the current request, never error text. */
    outcome(
      controller: AbortController,
      outcome: import('./outcome').RagConversationOutcome,
    ) {
      const entry = owners.get(controller);
      if (
        entry &&
        entries.get(entry.id) === entry &&
        !entry.status &&
        !controller.signal.aborted &&
        (outcome.status === 'failure' || outcome.status === 'unavailable')
      )
        entry.diagnose(
          'outcome',
          undefined,
          outcome.status === 'failure' ? outcome.kind : 'unavailable',
        );
    },
    /** Only observed workflow milestones advance the system UI; never elapsed-time estimates. */
    answered(controller: AbortController, committed: boolean) {
      const entry = owners.get(controller);
      if (
        !entry ||
        entries.get(entry.id) !== entry ||
        entry.status ||
        controller.signal.aborted
      )
        return;
      input.execution?.milestone?.(entry.executionId, 'answered');
      if (committed)
        input.execution?.milestone?.(entry.executionId, 'committed');
    },
    interrupt(id: number, status: StopStatus, erase = false) {
      const entry = entries.get(id);
      if (!entry || entry.status) return;
      interruptConversationLifetime(
        entry,
        status,
        erase,
        input.execution,
        () => {
          if (entries.get(id) === entry) input.reportFenceFailure(id);
        },
      );
    },
    status(id: number, controller: AbortController) {
      return owners.get(controller)?.status;
    },
    interruptionReason(controller: AbortController) {
      return owners.get(controller)?.interruptionReason;
    },
    /** Final cleanup must retain the same interruption reason already used by Stop. */
    failureStatus(controller: AbortController): StopStatus | 'failed' {
      return controller.signal.aborted
        ? (owners.get(controller)?.status ?? 'cancelled')
        : 'failed';
    },
    async settle(id: number, controller: AbortController) {
      const entry = owners.get(controller);
      if (!entry) return;
      let observed: Promise<void> | undefined;
      do {
        observed = entry.fence;
        await observed;
      } while (observed !== entry.fence);
      entry.release?.();
      if (entries.get(id) === entry) entries.delete(id);
      // Weak ownership retains the terminal Stop reason without preventing collection.
    },
  };
}
