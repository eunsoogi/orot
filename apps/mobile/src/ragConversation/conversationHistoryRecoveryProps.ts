import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

/** Keep initial restore and older-page recovery actions tied to the same session owner. */
export function conversationHistoryRecoveryProps(
  session: ConversationSession,
  store: Pick<
    ConversationSessions,
    'loadOlderHistory' | 'synchronizeModel' | 'retryRestore'
  > &
    Partial<
      Pick<
        ConversationSessions,
        'toolSourceSessionId' | 'getSnapshot' | 'readExplicitPriorVoiceContext'
      >
    >,
  active = true,
) {
  // Initial canonical lookup has no durable session yet. A send-time model
  // refresh on an already attached conversation is not history loading.
  const resolvingInitialHistory =
    session.modelSelectionPending &&
    store.toolSourceSessionId?.(session.id) === null &&
    !session.preparingSend;
  return {
    savedHistoryDisplay: visibleSavedHistoryDisplay(session, active),
    voiceEndCards: session.taskCards
      ?.filter(card => card.task.kind === 'voice_end')
      .map(card => {
        if (
          !active ||
          !card.hasObservedVoiceCaptions ||
          !store.readExplicitPriorVoiceContext
        )
          return card;
        return {
          ...card,
          observedQuote: (signal: AbortSignal) =>
            store.readExplicitPriorVoiceContext!({
              session: session.id,
              marker: card.id,
              signal,
              isExplicitSelectionCurrent: () => {
                const snapshot = store.getSnapshot?.();
                const selected = snapshot?.sessions.find(
                  item => item.id === snapshot.activeId,
                );
                return (
                  selected?.id === session.id &&
                  !selected.quarantined &&
                  !selected.restoring &&
                  Boolean(
                    selected.taskCards?.some(
                      item =>
                        item.id === card.id &&
                        item.revision === card.revision &&
                        item.hasObservedVoiceCaptions,
                    ),
                  )
                );
              },
            }),
        };
      }),
    // Blocking/quarantine and send/save activity are not history restoration.
    restoringHistory: Boolean(
      active &&
      !session.quarantined &&
      !session.restoreFailed &&
      !session.modelSelectionFailed &&
      (session.restoring || resolvingInitialHistory),
    ),
    restoring:
      !active ||
      session.restoring ||
      session.quarantined ||
      session.modelSelectionPending,
    historyHasMore: session.historyHasMore,
    historyLoading: session.historyLoading,
    historyLoadFailed: session.historyLoadFailed,
    onLoadOlderHistory: (signal?: AbortSignal) =>
      store.loadOlderHistory(session.id, signal),
    restoreFailed: session.restoreFailed || session.modelSelectionFailed,
    onRetryRestore: () => {
      if (session.modelSelectionFailed)
        store.synchronizeModel(true).catch(() => {});
      else store.retryRestore(session.id);
    },
  };
}
