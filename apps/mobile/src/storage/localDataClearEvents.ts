type Listener = () => void;
const listeners = new Set<Listener>();
const sourceListeners = new Set<Listener>();

/** Notify in-memory owners after the authoritative local-data transaction commits. */
export function subscribeLocalDataClear(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One failing observer must not turn an already committed deletion into a reported rollback. */
export function notifyLocalDataCleared() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* Other owners must still clear their cached data. */
    }
  }
}

/** Revalidate visible derived content after an individual source transaction commits. */
export function subscribeLocalSourceDeletion(listener: Listener) {
  sourceListeners.add(listener);
  return () => {
    sourceListeners.delete(listener);
  };
}

export function notifyLocalSourceDeleted() {
  for (const listener of sourceListeners) {
    try {
      listener();
    } catch {
      /* A committed deletion cannot be rolled back by an observer. */
    }
  }
}
