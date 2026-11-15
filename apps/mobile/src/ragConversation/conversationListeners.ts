/** Keeps state synchronous while coalescing token-driven React notifications in 16ms windows. */
export function createConversationListeners() {
  const listeners = new Map<() => void, (() => boolean) | undefined>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  const emit = () => {
    // Terminal, cancellation, deletion and user-input updates supersede queued previews.
    clear();
    listeners.forEach((_visible, listener) => listener());
  };
  return {
    emit,
    emitStream() {
      if (pending !== undefined || listeners.size === 0) return;
      // A macrotask yields to input/layout; a Promise microtask would keep draining
      // ahead of UI work. This batches presentation, not persistence or execution.
      pending = setTimeout(() => {
        pending = undefined;
        // Hidden retained routes still receive lifecycle/privacy updates via emit,
        // but need not repeatedly lay out an invisible growing transcript.
        listeners.forEach((visible, listener) => {
          if (!visible || visible()) listener();
        });
      }, 16);
    },
    dispose() {
      clear();
      listeners.clear();
    },
    subscribe(listener: () => void, visible?: () => boolean) {
      listeners.set(listener, visible);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clear();
      };
    },
  };
}
