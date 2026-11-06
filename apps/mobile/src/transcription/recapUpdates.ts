const listeners = new Set<() => void>();

/** Signals durable changes; subscribers always reread the database rather than trusting the event. */
export function publishRecapUpdate() {
  listeners.forEach(listener => listener());
}

export function subscribeRecapUpdates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
