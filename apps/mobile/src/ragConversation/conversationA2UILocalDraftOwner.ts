import { createContext, useMemo } from 'react';
import { AppState } from 'react-native';
import type { ConversationA2UINode } from './conversationA2UI';
import type { ConversationSessions } from './conversationSessions';

interface Owner {
  readonly surface: (root: ConversationA2UINode) => string | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

export const ConversationA2UILocalDraftOwner = createContext<Owner | undefined>(
  undefined,
);

/** Resolve the stamp from live owning session state, not a render snapshot
 * and never the model's fixed draft stamp. Closing/replacing a session or
 * starting another request must invalidate already queued native callbacks. */
export function useConversationA2UILocalDraftOwner(
  store: ConversationSessions,
  sessionId: number,
  ownsPresentation?: () => boolean,
) {
  return useMemo<Owner>(
    () => ({
      surface(root) {
        if (
          AppState.currentState !== 'active' ||
          ownsPresentation?.() === false ||
          !store.ownsActiveSession(sessionId)
        )
          return undefined;
        const session = store
          .getSnapshot()
          .sessions.find(item => item.id === sessionId);
        if (
          !session ||
          session.quarantined ||
          session.restoring ||
          session.busy ||
          session.pendingMessage ||
          session.leaseRefreshRequired
        )
          return undefined;
        const last = session.messages.at(-1);
        if (last?.role !== 'assistant' || last.a2uiPresentation !== root)
          return undefined;
        return `orot:${sessionId}:${last.id}`;
      },
      subscribe(listener) {
        const stop = store.subscribe(listener);
        const appState = AppState.addEventListener('change', listener);
        return () => {
          stop();
          appState.remove();
        };
      },
    }),
    [ownsPresentation, sessionId, store],
  );
}
