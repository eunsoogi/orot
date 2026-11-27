import type { RagConversationObserver } from './service';
import {
  beginOrdinaryConversationMemoryTask,
  type OrdinaryConversationMemoryPort,
} from './ordinaryConversationMemoryTask';
import type { createConversationTurnRetention } from './conversationTurnRetention';

type Task = NonNullable<ReturnType<typeof beginOrdinaryConversationMemoryTask>>;
type Turn = ReturnType<typeof createConversationTurnRetention>;

/** Optional detached local writes keep their own session ownership after reply
 * presentation. Removing/replacing that session cannot leave a grant behind. */
export function createConversationOrdinaryMemoryOwner(
  port: OrdinaryConversationMemoryPort | undefined,
) {
  const draft = new Map<number, Task>();
  const awaitingGrant = new Map<number, Task>();
  const displayed = new Map<number, Set<Task>>();
  const retire = (
    id: number,
    owners: Map<number, Task>,
    task = owners.get(id),
  ) => {
    if (!task || owners.get(id) !== task) return;
    owners.delete(id);
    task.discard();
  };
  const retireDisplayed = (id: number, task: Task) => {
    const active = displayed.get(id);
    if (!active?.delete(task)) return;
    if (!active.size) displayed.delete(id);
    task.discard();
  };
  const discard = (id: number) => {
    retire(id, draft);
    retire(id, awaitingGrant);
    for (const task of displayed.get(id) ?? []) retireDisplayed(id, task);
  };
  return {
    discard,
    dispose: () => {
      for (const id of draft.keys()) discard(id);
      for (const id of awaitingGrant.keys()) discard(id);
      for (const id of displayed.keys()) discard(id);
    },
    begin(
      id: number,
      question: string,
      admissionSignal: AbortSignal,
      ordinary: boolean | 'quick-choice',
    ) {
      // A new send replaces only an undisplayed proposal. The previous
      // displayed completion still owns its existing detached settlement.
      if (ordinary === 'quick-choice') {
        // The proven same-session choice cannot nominate or borrow a grant.
        // Only the older displayed completion may settle using its own proof.
        retire(id, draft);
        retire(id, awaitingGrant);
        return;
      }
      if (!ordinary) {
        discard(id);
        return;
      }
      retire(id, draft);
      const task =
        port &&
        beginOrdinaryConversationMemoryTask(port, question, admissionSignal);
      if (!task) return;
      draft.set(id, task);
      return {
        discard: () => retire(id, draft, task),
        wrap(
          retained: Pick<Turn, 'ordinaryMemorySource'>,
          observer: Pick<
            RagConversationObserver,
            'onRetentionCandidate' | 'onRetentionFailure'
          >,
        ) {
          const source = retained.ordinaryMemorySource();
          if (source) task.attach(source);
          return {
            ...observer,
            bindOrdinaryMemorySidecar: task.bindSidecar,
            async onRetentionCandidate(
              ...[candidate, signal]: Parameters<
                NonNullable<RagConversationObserver['onRetentionCandidate']>
              >
            ) {
              await observer.onRetentionCandidate?.(candidate, signal);
              task.propose(candidate);
            },
          };
        },
        show() {
          if (draft.get(id) !== task) return;
          if (!task.hasPendingProposal()) {
            retire(id, draft, task);
            return;
          }
          // Before a positive current grant there is only one transient candidate.
          // It cannot evict a still-authorized settlement.
          draft.delete(id);
          retire(id, awaitingGrant);
          awaitingGrant.set(id, task);
          task
            .finish(
              () =>
                awaitingGrant.get(id) === task ||
                displayed.get(id)?.has(task) === true,
              () => {
                if (awaitingGrant.get(id) !== task) return false;
                awaitingGrant.delete(id);
                const active = displayed.get(id) ?? new Set<Task>();
                displayed.set(id, active);
                active.add(task);
                // At most two eligible completed settlements, not a durable queue.
                const oldest = active.values().next().value;
                if (active.size > 2 && oldest) retireDisplayed(id, oldest);
                return true;
              },
            )
            .finally(() => {
              retire(id, awaitingGrant, task);
              retireDisplayed(id, task);
            });
        },
      };
    },
  };
}
