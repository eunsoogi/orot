import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { ConversationSession } from './conversationSessionRequests';
import type { PendingTurn } from './conversationSessionTypes';
import type { RagConversationObserver } from './service';

type Turn = ReturnType<typeof createConversationTurnRetention>;

/** Keep failed writes until explicitly retried or their owning conversation is removed. */
export function createConversationRequestSaveRecovery(
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  const pending = new Map<number, Turn[]>();
  const retrying = new Map<number, AbortController>();
  const failed = (id: number, turn: Turn) => {
    const turns = pending.get(id) ?? [];
    if (turn.canRetry() && !turns.includes(turn)) turns.push(turn);
    if (turns.length) pending.set(id, turns);
    update(id, {
      unsavedCount: turns.length,
      error: '답변을 저장하지 못했어요.',
    });
  };
  return {
    observer(
      id: number,
      turn: Turn,
      request: PendingTurn,
      current: () => boolean,
    ): Pick<
      RagConversationObserver,
      'onRetentionCandidate' | 'onRetentionFailure'
    > {
      return {
        async onRetentionCandidate(candidate, signal) {
          request.saving = true;
          try {
            await turn.save(candidate, signal);
            request.committed = true;
          } finally {
            request.saving = false;
          }
        },
        onRetentionFailure() {
          if (current()) failed(id, turn);
        },
      };
    },
    async retry(id: number) {
      const turns = pending.get(id);
      if (!turns?.length || retrying.has(id)) return;
      const turn = turns[0]!;
      const controller = new AbortController();
      retrying.set(id, controller);
      update(id, { retryingSave: true });
      try {
        await turn.retry(controller.signal);
        if (pending.get(id) !== turns) return;
        turns.shift();
        if (!turns.length) pending.delete(id);
        update(id, {
          unsavedCount: turns.length,
          error: turns.length ? '저장하지 못한 답변이 남아 있어요.' : '',
        });
      } catch {
        if (pending.get(id) === turns)
          update(id, {
            error: '답변을 저장하지 못했어요. 다시 시도해 주세요.',
          });
      } finally {
        if (retrying.get(id) === controller) retrying.delete(id);
        if (pending.get(id) === turns || !pending.has(id))
          update(id, { retryingSave: false });
      }
    },
    forget(id: number) {
      retrying.get(id)?.abort();
      retrying.delete(id);
      for (const turn of pending.get(id) ?? []) turn.discardRetry();
      pending.delete(id);
    },
    dispose() {
      for (const controller of retrying.values()) controller.abort();
      retrying.clear();
      for (const turns of pending.values())
        for (const turn of turns) turn.discardRetry();
      pending.clear();
    },
  };
}
