import type { ConversationExecutionAdapter } from './conversationExecutionLease';
import { beginConversationExecutionLease } from './conversationExecutionLease';
import type { createConversationTurnRetention } from './conversationTurnRetention';

type Turn = ReturnType<typeof createConversationTurnRetention>;
type StopStatus = 'cancelled' | 'interrupted';
type Entry = {
  controller: AbortController;
  turn: Turn;
  status?: StopStatus;
  start?: Promise<void>;
  fence?: Promise<void>;
  release?: () => void;
};

/** Binds the checkpoint and bounded OS lease to the same request, including stop races. */
export function createConversationRequestLifetime(input: {
  execution?: ConversationExecutionAdapter;
  interrupt: (id: number) => void;
  reportFenceFailure: (id: number) => void;
}) {
  const entries = new Map<number, Entry>();
  const owners = new WeakMap<AbortController, Entry>();
  return {
    async start(
      id: number,
      controller: AbortController,
      turn: Turn,
      question: string,
      submittedInput?: import('./conversationSubmittedInput').ConversationSubmittedInput,
    ) {
      const entry: Entry = { controller, turn };
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
          turn.toolMessageId,
          () => {
            if (entries.get(id) === entry && !controller.signal.aborted)
              input.interrupt(id);
          },
        );
      }
    },
    interrupt(id: number, status: StopStatus, erase = false) {
      const entry = entries.get(id);
      if (!entry || entry.status) return;
      entry.status = status;
      // Stop ends execution but keeps its submitted input; only destructive abandonment erases it.
      entry.fence = (async () => {
        // A stop during the initial write must fence the row after it exists.
        await entry.start?.catch(() => {});
        await entry.turn.interruptRequest(erase ? 'cancelled' : 'interrupted');
      })().catch(() => {
        if (entries.get(id) === entry) input.reportFenceFailure(id);
      });
    },
    status(id: number, controller: AbortController) {
      return owners.get(controller)?.status;
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
      owners.delete(controller);
    },
  };
}
