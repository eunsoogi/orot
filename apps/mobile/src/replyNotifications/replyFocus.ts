import { useSyncExternalStore } from 'react';

type Target = { readonly sessionId: number; readonly messageId: string };
let target: Target | null = null;
const listeners = new Set<() => void>();

/** A focus request contains identities only and is consumed after the target is laid out. */
export const replyFocus = {
  get: () => target,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(value: Target) {
    target = value;
    listeners.forEach(listener => listener());
  },
  clear(value: Target) {
    if (target !== value) return;
    target = null;
    listeners.forEach(listener => listener());
  },
};

export function useReplyFocusForSession(sessionId: number) {
  const current = useSyncExternalStore(replyFocus.subscribe, replyFocus.get);
  return current?.sessionId === sessionId
    ? { messageId: current.messageId, done: () => replyFocus.clear(current) }
    : undefined;
}
