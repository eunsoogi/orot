/** Keeps state synchronous while coalescing token-driven React notifications in 16ms windows. */
export function createConversationListeners() {
  const listeners = new Map<() => void, { visible?: () => boolean }>();
  let pending: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
  };
  const notify = (stream: boolean) => {
    // Iterate registrations, not a live Map: render cleanup may re-subscribe the
    // same function. New registrations belong to the next publication.
    for (const [listener, registration] of [...listeners]) {
      if (listeners.get(listener) !== registration) continue;
      try {
        if (stream && registration.visible && !registration.visible()) continue;
        // A visibility callback can itself detach or replace this registration.
        if (listeners.get(listener) === registration) listener();
      } catch {
        // Presentation must not block another observer or abort/persistence cleanup.
        // Only observer code is isolated; request and storage errors still propagate.
      }
    }
  };
  const emit = () => {
    // Terminal, cancellation, deletion and user-input updates supersede queued previews.
    clear();
    notify(false);
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
        notify(true);
      }, 16);
    },
    dispose() {
      clear();
      listeners.clear();
    },
    subscribe(listener: () => void, visible?: () => boolean) {
      const registration = { visible };
      listeners.set(listener, registration);
      return () => {
        // An escaped unsubscribe must not detach a newer registration of this function.
        if (listeners.get(listener) === registration)
          listeners.delete(listener);
        if (listeners.size === 0) clear();
      };
    },
  };
}
