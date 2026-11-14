/** Keeps state synchronous while limiting token-driven React notifications to one per frame. */
export function createConversationListeners() {
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  const emit = () => {
    // Terminal, cancellation, deletion and user-input updates supersede queued previews.
    clear();
    listeners.forEach(listener => listener());
  };
  return {
    emit,
    emitStream() {
      if (pending !== undefined || listeners.size === 0) return;
      // A macrotask yields to input/layout; a Promise microtask would keep draining
      // ahead of UI work. This batches presentation, not persistence or execution.
      pending = setTimeout(emit, 16);
    },
    dispose() {
      clear();
      listeners.clear();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clear();
      };
    },
  };
}
