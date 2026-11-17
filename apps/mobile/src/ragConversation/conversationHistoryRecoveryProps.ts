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
  >,
) {
  return {
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
