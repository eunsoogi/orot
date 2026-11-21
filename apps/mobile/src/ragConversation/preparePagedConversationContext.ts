import type { ConversationHistoryReaderOwner } from './conversationHistoryPage';
import type { ConversationSession } from './conversationSessionTypes';

/** Retry a failed read once per explicit send; never dispatch with unvalidated history. */
export function preparePagedConversationContext(
  owners: Map<number, ConversationHistoryReaderOwner>,
  find: (id: number) => ConversationSession | undefined,
  load: (id: number, signal?: AbortSignal) => Promise<void>,
) {
  return async (id: number, signal?: AbortSignal) => {
    let retried = false;
    while (owners.has(id) && !signal?.aborted) {
      const owner = owners.get(id)!;
      const session = find(id);
      if (!session || session.quarantined) return false;
      if (session.restoreFailed || session.historyLoadFailed) {
        if (retried) return false;
        retried = true;
        await load(id, signal);
        if (owners.get(id) !== owner) return false;
        continue;
      }
      if (
        owner.initialized &&
        (owner.exhausted ||
          session.messages.filter(
            message =>
              !message.incomplete &&
              !message.failed &&
              !message.historyUnavailable,
          ).length >= 8)
      )
        return true;
      const previous = owner.cursor;
      await load(id, signal);
      if (signal?.aborted || owners.get(id) !== owner) return false;
      if (
        owner.cursor === previous &&
        !owner.exhausted &&
        !find(id)?.restoreFailed &&
        !find(id)?.historyLoadFailed
      )
        return false;
    }
    const session = find(id);
    return (
      !signal?.aborted &&
      !session?.restoreFailed &&
      !session?.leaseRefreshRequired
    );
  };
}
