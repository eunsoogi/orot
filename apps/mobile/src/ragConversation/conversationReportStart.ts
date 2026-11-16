import { useCallback, useSyncExternalStore } from 'react';
import type { ConversationSessions } from './conversationSessions';

type Request = { claim: () => boolean };
const requests = new WeakMap<ConversationSessions, Map<string, Request>>();
const listeners = new WeakMap<ConversationSessions, Set<() => void>>();

/** Ephemeral gesture authority is never serialized into a restored task card. */
export function requestReportStart(
  store: ConversationSessions,
  sessionId: number,
  cardId: string,
  isCurrent: () => boolean,
) {
  let entries = requests.get(store);
  if (!entries) {
    entries = new Map();
    requests.set(store, entries);
  }
  const key = `${sessionId}:${cardId}`;
  // A repeated tap before readiness shares the same one-shot request.
  if (entries.has(key)) return;
  const request: Request = {
    claim: () => {
      if (entries!.get(key) !== request) return false;
      entries!.delete(key);
      return (
        isCurrent() &&
        store.getSnapshot().activeId === sessionId &&
        Boolean(
          store
            .getSnapshot()
            .sessions.find(item => item.id === sessionId)
            ?.taskCards?.some(card => card.id === cardId),
        )
      );
    },
  };
  entries.set(key, request);
  for (const listener of listeners.get(store) ?? []) listener();
}

/** Cards subscribe to explicit live taps; mounting a historical card provides no request. */
export function useRequestedReportStart(
  store: ConversationSessions,
  sessionId: number,
  cardId: string,
) {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        let subscriptions = listeners.get(store);
        if (!subscriptions) {
          subscriptions = new Set();
          listeners.set(store, subscriptions);
        }
        subscriptions.add(listener);
        return () => {
          subscriptions!.delete(listener);
          requests.get(store)?.delete(`${sessionId}:${cardId}`);
        };
      },
      [store, sessionId, cardId],
    ),
    () => requests.get(store)?.get(`${sessionId}:${cardId}`),
  )?.claim;
}
