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
  const tasks = new Map<number, Task>();
  const discard = (id: number) => {
    tasks.get(id)?.discard();
    tasks.delete(id);
  };
  return {
    discard,
    dispose: () => {
      for (const id of tasks.keys()) discard(id);
    },
    begin(
      id: number,
      question: string,
      admissionSignal: AbortSignal,
      ordinary: boolean,
    ) {
      discard(id);
      const task =
        ordinary &&
        port &&
        beginOrdinaryConversationMemoryTask(port, question, admissionSignal);
      if (!task) return;
      tasks.set(id, task);
      return {
        discard: () => tasks.get(id) === task && discard(id),
        wrap(
          retained: Turn,
          observer: Pick<
            RagConversationObserver,
            'onRetentionCandidate' | 'onRetentionFailure'
          >,
        ) {
          const source = retained.ordinaryMemorySource();
          if (source) task.attach(source);
          return {
            ...observer,
            async onRetentionCandidate(candidate, signal) {
              await observer.onRetentionCandidate?.(candidate, signal);
              task.propose(candidate);
            },
          } satisfies typeof observer;
        },
        show() {
          // Start only after the answer is published to the React session. Do
          // not await Keychain/SQLite or add this to the user-facing reply time.
          task
            .finish(() => tasks.get(id) === task)
            .finally(() => {
              if (tasks.get(id) === task) discard(id);
            });
        },
      };
    },
  };
}
