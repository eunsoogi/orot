import type {
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import { t } from '../i18n';

/** Refresh only task references after source deletion without replacing an active transcript. */
export function createConversationTaskRefresh(input: {
  options: ConversationSessionOptions;
  find: (id: number) => ConversationSession | undefined;
  update: (id: number, change: Partial<ConversationSession>) => void;
  valid: () => boolean;
}) {
  const pending = new Map<
    number,
    { durableId: string; controller: AbortController }
  >();
  const refresh = async (id: number, durableId: string) => {
    pending.get(id)?.controller.abort();
    const entry = { durableId, controller: new AbortController() };
    pending.set(id, entry);
    try {
      const cards = await input.options.restoreTasks!(
        durableId,
        entry.controller.signal,
      );
      const current = input.find(id);
      if (
        !input.valid() ||
        pending.get(id) !== entry ||
        entry.controller.signal.aborted ||
        !current ||
        input.options.retention?.activeIdentity(id) !== durableId
      )
        return;
      // Cards created after the deletion event remain authoritative over this read.
      const currentCards = current.taskCards ?? [];
      const ids = new Set(currentCards.map(card => card.id));
      input.update(id, {
        taskCards: [
          ...currentCards,
          ...cards.filter(
            card => card.task.kind === 'treatment' && !ids.has(card.id),
          ),
        ],
        restoreFailed: false,
        ...(current.error === t('ragConversation.history.restoreFailed')
          ? { error: '' }
          : {}),
      });
      pending.delete(id);
    } catch {
      if (
        input.valid() &&
        pending.get(id) === entry &&
        !entry.controller.signal.aborted
      )
        input.update(id, {
          restoreFailed: true,
          error: t('ragConversation.history.restoreFailed'),
        });
    }
  };
  return {
    start(id: number, durableId: string) {
      if (input.options.restoreTasks) return refresh(id, durableId);
      return Promise.resolve();
    },
    has: (id: number) => pending.has(id),
    retry(id: number) {
      const entry = pending.get(id);
      return entry ? refresh(id, entry.durableId) : Promise.resolve();
    },
    invalidate() {
      for (const entry of pending.values()) entry.controller.abort();
      pending.clear();
    },
  };
}
