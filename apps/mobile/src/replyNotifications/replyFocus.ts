import { useRef, useSyncExternalStore } from 'react';

type Request = { readonly sessionId: number; readonly messageId: string };
type Target = Request & { readonly generation: number };
export type ReplyFocusHandle = {
  readonly generation: number;
  readonly messageId: string;
  canReveal(): boolean;
  complete(): boolean;
};
let target: Target | null = null;
let nextGeneration = 0;
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
  set(value: Request) {
    target = { ...value, generation: ++nextGeneration };
    listeners.forEach(listener => listener());
  },
  clear(value: Target) {
    if (target !== value) return;
    target = null;
    listeners.forEach(listener => listener());
  },
};

export function useReplyFocusForSession(
  sessionId: number,
  isEntryCurrent?: () => boolean,
): ReplyFocusHandle | undefined {
  const current = useSyncExternalStore(replyFocus.subscribe, replyFocus.get);
  const live = useRef({ sessionId, isEntryCurrent });
  live.current = { sessionId, isEntryCurrent };
  const canReveal = () =>
    !!current &&
    replyFocus.get() === current &&
    live.current.sessionId === current.sessionId &&
    live.current.isEntryCurrent?.() === true;
  return current?.sessionId === sessionId
    ? {
        generation: current.generation,
        messageId: current.messageId,
        canReveal,
        complete: () => {
          if (!canReveal()) return false;
          replyFocus.clear(current);
          return true;
        },
      }
    : undefined;
}
