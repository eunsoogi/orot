const listeners = new Set<() => void>();

/** A local signal only: no imported workout identity or contents leave storage. */
export function subscribeWorkoutImportCommitted(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyWorkoutImportCommitted() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // An observer cannot roll back an already committed import.
    }
  }
}
