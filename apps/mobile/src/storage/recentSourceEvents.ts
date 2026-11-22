const listeners = new Set<() => void>();

export function subscribeRecentSourceSaved(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Signal only successful persisted imports/audio links, without exposing source identities. */
export function notifyRecentSourceSaved() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // The saved source stays committed even when a scene observer has gone away.
    }
  }
}
