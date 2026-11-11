import type { ConversationTaskCard } from '../storage/conversationTaskCards';
import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';

export interface RetainedConversationTask {
  readonly id: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly task: ConversationTaskCard;
}

/** Serialize each card's changes so late results cannot overwrite a newer revision. */
export function createConversationTaskState(input: {
  retention?: ConversationSessionOptions['retention'];
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  valid: () => boolean;
  activeId: () => number;
}) {
  const queues = new Map<string, Promise<void>>();
  const controllers = new Set<AbortController>();
  const routeOwners = new Map<string, number>();
  let generation = 0;
  const cancelWrites = () => {
    generation += 1;
    for (const controller of controllers) controller.abort();
    queues.clear();
  };
  return {
    invalidate() {
      cancelWrites();
      routeOwners.clear();
    },
    invalidateWrites() {
      cancelWrites();
    },
    reportTaskOwner(routeKey: string) {
      const existing = routeOwners.get(routeKey);
      if (existing !== undefined) return existing;
      const owner = input.activeId();
      routeOwners.set(routeKey, owner);
      return owner;
    },
    selectDailyReport(
      id: number,
      dailyReport: NonNullable<ConversationSession['dailyReport']>,
    ) {
      if (input.activeId() !== id || input.find(id)?.quarantined) return;
      input.update(id, { dailyReport });
    },
    forgetTaskCard(id: number, cardId: string) {
      const session = input.find(id);
      if (session)
        input.update(id, {
          taskCards: session.taskCards?.filter(card => card.id !== cardId),
        });
    },
    save(
      sessionId: number,
      cardId: string,
      task: ConversationTaskCard,
      expectedCardRevision?: number,
    ) {
      // Freeze the requested identifiers before queued asynchronous work can start.
      const requested = JSON.parse(
        JSON.stringify(task),
      ) as ConversationTaskCard;
      const key = `${sessionId}:${cardId}`;
      const started = generation;
      const prior = queues.get(key) ?? Promise.resolve();
      const result = prior
        .catch(() => {})
        .then(async () => {
          const session = input.find(sessionId);
          if (
            !input.valid() ||
            started !== generation ||
            !session ||
            session.quarantined ||
            session.restoring ||
            session.restoreFailed
          )
            throw new Error('Conversation is unavailable.');
          const previous = session.taskCards?.find(card => card.id === cardId);
          // A completed operation must not replace a card changed while it ran.
          if (
            expectedCardRevision !== undefined &&
            previous?.revision !== expectedCardRevision
          )
            return;
          // Revisiting the same day must not erase a retained result identity.
          const nextTask =
            (requested.kind === 'daily_report' &&
              !requested.report &&
              previous?.task.kind === 'daily_report' &&
              previous.task.identity.key === requested.identity.key) ||
            (requested.kind === 'treatment' &&
              !requested.artifactRevision &&
              previous?.task.kind === 'treatment' &&
              previous.task.artifactId === requested.artifactId)
              ? previous.task
              : requested;
          if (
            previous &&
            JSON.stringify(previous.task) === JSON.stringify(nextTask)
          )
            return;
          const createdAt = previous?.createdAt ?? new Date().toISOString();
          const revision = previous?.revision ?? null;
          if (input.retention && !input.retention.saveTaskCard)
            throw new Error('Conversation task storage is unavailable.');
          let stored: RetainedConversationTask | undefined;
          if (input.retention?.saveTaskCard) {
            const controller = new AbortController();
            controllers.add(controller);
            try {
              stored = await input.retention.saveTaskCard(
                sessionId,
                {
                  id: cardId,
                  createdAt,
                  expectedRevision: revision,
                  task: nextTask,
                },
                controller.signal,
              );
            } finally {
              controllers.delete(controller);
            }
          }
          const current = input.find(sessionId);
          if (
            !input.valid() ||
            started !== generation ||
            !current ||
            current.quarantined
          )
            throw new Error('Conversation changed while saving the task.');
          const card = stored ?? {
            id: cardId,
            createdAt,
            revision: (revision ?? 0) + 1,
            task: nextTask,
          };
          input.update(sessionId, {
            taskCards: [
              ...(current.taskCards ?? []).filter(item => item.id !== cardId),
              card,
            ],
          });
        });
      const settled = result.then(
        () => {},
        () => {},
      );
      queues.set(key, settled);
      settled.then(() => {
        if (queues.get(key) === settled) queues.delete(key);
      });
      return result;
    },
  };
}
