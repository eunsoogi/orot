import { useEffect, useReducer, useRef } from 'react';

/** Only an explicit retained-reply target may request older pages without a reader drag. */
export function useConversationHistoryTarget(input: {
  sessionId?: number;
  focusId?: string;
  focusGeneration?: number;
  found: boolean;
  hasMore?: boolean;
  loading?: boolean;
  failed?: boolean;
  loadOlder?: (signal?: AbortSignal) => Promise<void>;
}) {
  const [, render] = useReducer(value => value + 1, 0);
  const owner = useRef<{
    controller: AbortController;
    running: boolean;
    blocked: boolean;
  } | null>(null);
  useEffect(() => {
    const current = {
      controller: new AbortController(),
      running: false,
      blocked: false,
    };
    owner.current = current;
    return () => {
      current.controller.abort();
      if (owner.current === current) owner.current = null;
    };
  }, [input.sessionId, input.focusId, input.focusGeneration]);
  // Recheck after both page publication and promise settlement: those notifications can arrive separately.
  useEffect(() => {
    const current = owner.current;
    if (
      !current ||
      current.running ||
      current.blocked ||
      current.controller.signal.aborted ||
      !input.focusId ||
      input.found ||
      !input.hasMore ||
      input.loading ||
      input.failed ||
      !input.loadOlder
    )
      return;
    current.running = true;
    input
      .loadOlder(current.controller.signal)
      .catch(() => {
        current.blocked = true;
      })
      .finally(() => {
        if (owner.current !== current || current.controller.signal.aborted)
          return;
        current.running = false;
        render();
      });
  });
}
