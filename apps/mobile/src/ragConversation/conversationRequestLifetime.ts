import { waitForWorkflowContinue } from './conversationWorkflowContinueWait';
import { requiresConversationDecisionAbort } from './conversationApprovalBoundary';
import type {
  ConversationExecutionAdapter,
  ConversationInterruptionReason,
} from './conversationExecutionLease';
import { beginConversationExecutionLease } from './conversationExecutionLease';
import type { createConversationTurnRetention } from './conversationTurnRetention';

type Turn = ReturnType<typeof createConversationTurnRetention>;
type StopStatus = 'cancelled' | 'interrupted';
export type ConversationLifetimeEntry = {
  id: number;
  executionId: string;
  leaseAttempt: number;
  waitingForDecision?: boolean;
  resumableApproval?: boolean;
  requestPause?: () => void;
  controller: AbortController;
  turn: Turn;
  status?: StopStatus;
  interruptionReason?: ConversationInterruptionReason;
  start?: Promise<void>;
  fence?: Promise<void>;
  release?: () => void;
};

/** Binds the checkpoint and bounded OS lease to the same request, including stop races. */
export function createConversationRequestLifetime(input: {
  execution?: ConversationExecutionAdapter;
  interrupt: (id: number) => void;
  reportFenceFailure: (id: number) => void;
  pauseState?: (id: number, resume?: () => void) => void;
}) {
  const entries = new Map<number, ConversationLifetimeEntry>();
  const owners = new WeakMap<AbortController, ConversationLifetimeEntry>();
  return {
    async start(
      id: number,
      controller: AbortController,
      turn: Turn,
      question: string,
      submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput,
    ) {
      const entry: ConversationLifetimeEntry = {
        id,
        controller,
        turn,
        leaseAttempt: 1,
        executionId: `${turn.toolMessageId}:lease:${id}:1`,
      };
      entries.set(id, entry);
      owners.set(controller, entry);
      entry.start = turn.startRequest(
        question,
        controller.signal,
        submittedInput,
      );
      await entry.start;
      if (controller.signal.aborted) return;
      if (input.execution) {
        entry.release = await beginConversationExecutionLease(
          input.execution,
          entry.executionId,
          reason => {
            if (entries.get(id) === entry && !controller.signal.aborted) {
              entry.interruptionReason = reason;
              input.interrupt(id);
            }
          },
          () => requiresConversationDecisionAbort(entry, input.execution),
          () => entry.requestPause?.(),
        );
      }
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
        onWorkflowPauseController: (requestPause: () => void) => {
          const entry = owners.get(controller);
          if (
            entry &&
            entries.get(entry.id) === entry &&
            !controller.signal.aborted
          )
            entry.requestPause = requestPause;
        },
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
      entry.status = status;
      // Stop ends execution but keeps its submitted input; only destructive abandonment erases it.
      entry.fence = (async () => {
        // A stop during the initial write must fence the row after it exists.
        await entry.start?.catch(() => {});
        await entry.turn.interruptRequest(
          erase ? 'cancelled' : 'interrupted',
          entry.interruptionReason ??
            (status === 'cancelled' ? 'user-stopped' : 'provider-failed'),
        );
      })().catch(() => {
        if (entries.get(id) === entry) input.reportFenceFailure(id);
      });
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
      // Weak ownership preserves the terminal reason for delayed Stop rendering.
      // Releasing the controller still allows this entry to be collected.
    },
  };
}
