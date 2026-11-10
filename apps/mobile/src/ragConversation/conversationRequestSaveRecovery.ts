import type { createConversationTurnRetention } from './conversationTurnRetention';
import type { ConversationSession } from './conversationSessionTypes';
import type { PendingTurn } from './conversationSessionTypes';
import type { RagConversationObserver } from './service';

type Turn = ReturnType<typeof createConversationTurnRetention>;

/** Keep failed writes until explicitly retried or their owning conversation is removed. */
export function createConversationRequestSaveRecovery(
  update: (id: number, change: Partial<ConversationSession>) => void,
  find: (id: number) => ConversationSession | undefined,
) {
  const pending = new Map<number, Turn[]>();
  const retrying = new Map<number, AbortController>();
  const observed = new Map<number, Set<Turn>>();
  const suspended = new Set<number>();
  const failed = (id: number, turn: Turn) => {
    const turns = pending.get(id) ?? [];
    if (turn.canRetry() && !turns.includes(turn)) turns.push(turn);
    if (turns.length) pending.set(id, turns);
    update(id, {
      unsavedCount: turns.length,
      error: turns.length
        ? '답변을 저장하지 못했어요.'
        : '원본을 확인할 수 없어 답변을 저장하지 못했어요.',
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
      const turns = observed.get(id) ?? new Set<Turn>();
      turns.add(turn);
      observed.set(id, turns);
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
        onRetentionFailure(prepare) {
          if (prepare && current()) turn.defer(prepare);
          if (current()) failed(id, turn);
        },
      };
    },
    async retry(id: number) {
      const turns = pending.get(id);
      if (!turns?.length || retrying.has(id) || suspended.has(id)) return;
      while (turns.length && !turns[0]!.hasPending()) turns.shift();
      if (!turns.length) {
        pending.delete(id);
        update(id, { unsavedCount: 0 });
        return;
      }
      const turn = turns[0]!;
      const controller = new AbortController();
      retrying.set(id, controller);
      update(id, { retryingSave: true });
      try {
        await turn.retry(controller.signal);
        if (pending.get(id) !== turns) return;
        const index = turns.indexOf(turn);
        if (index >= 0) turns.splice(index, 1);
        if (!turns.length) pending.delete(id);
        const session = find(id);
        update(id, {
          // Bind the committed retry to the existing bubble without changing its content.
          ...(session && !session.quarantined
            ? {
                messages: session.messages.map(message =>
                  message.toolMessageId === turn.toolMessageId
                    ? { ...message, retainedTurnId: turn.toolMessageId }
                    : message,
                ),
              }
            : {}),
          unsavedCount: turns.length,
          error: turns.length ? '저장하지 못한 답변이 남아 있어요.' : '',
        });
      } catch {
        if (pending.get(id) === turns && !suspended.has(id)) {
          if (!turn.hasPending()) {
            const index = turns.indexOf(turn);
            if (index >= 0) turns.splice(index, 1);
            if (!turns.length) pending.delete(id);
          }
          update(id, {
            unsavedCount: turns.length,
            error: turn.hasPending()
              ? '답변을 저장하지 못했어요. 다시 시도해 주세요.'
              : '원본이 변경되어 답변을 저장할 수 없어요.',
          });
        }
      } finally {
        if (retrying.get(id) === controller) {
          retrying.delete(id);
          update(id, { retryingSave: false });
        }
      }
    },
    suspend(id: number) {
      suspended.add(id);
      const turns = pending.get(id) ?? [];
      for (const turn of observed.get(id) ?? []) {
        if (turn.hasPending() && !turns.includes(turn)) turns.push(turn);
      }
      if (turns.length) pending.set(id, turns);
      retrying.get(id)?.abort();
    },
    resume(id: number) {
      suspended.delete(id);
      const turns = pending.get(id) ?? [];
      const remaining = turns.filter(turn => turn.hasPending());
      turns.splice(0, turns.length, ...remaining);
      if (turns.length) pending.set(id, turns);
      else pending.delete(id);
      const count = turns.length;
      if (count)
        update(id, {
          unsavedCount: count,
          error: '저장하지 못한 답변이 남아 있어요.',
        });
    },
    forget(id: number) {
      retrying.get(id)?.abort();
      retrying.delete(id);
      update(id, { retryingSave: false });
      for (const turn of pending.get(id) ?? []) turn.discardRetry();
      pending.delete(id);
      observed.delete(id);
      suspended.delete(id);
    },
    dispose() {
      for (const controller of retrying.values()) controller.abort();
      retrying.clear();
      for (const turns of pending.values())
        for (const turn of turns) turn.discardRetry();
      pending.clear();
      observed.clear();
      suspended.clear();
    },
  };
}
