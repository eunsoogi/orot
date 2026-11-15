import { useCallback, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { ConversationSessions } from './conversationSessions';

/** Avoid invisible token paints while retaining immediate lifecycle/privacy invalidation. */
export function useConversationPresentationSnapshot(
  store: ConversationSessions,
  isEntryCurrent?: () => boolean,
) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = store.subscribe(listener, isEntryCurrent);
      // Foreground return need not produce another token or parent render.
      // Re-read even if the owner's AppState callback has not run yet.
      const foreground = AppState.addEventListener('change', state => {
        if (state === 'active') listener();
      });
      return () => {
        foreground.remove();
        unsubscribe();
      };
    },
    [store, isEntryCurrent],
  );
  return useSyncExternalStore(subscribe, store.getSnapshot);
}
