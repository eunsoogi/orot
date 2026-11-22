const listeners = new Set<() => void>();

/** The shared protected archive can invalidate metadata without publishing identifiers. */
export function subscribeConversationVisibility(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Committed visibility changes stand even if a route listener is already gone. */
export function notifyConversationVisibilityChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One UI listener cannot undo the archive transaction or block another.
    }
  }
}
