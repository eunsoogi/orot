const listeners = new Set<() => void>();
const retryListeners = new Set<(appointmentId: string) => void>();

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

/** A retry resumes processing; it never approves generated content or remote transmission. */
export function requestRecapRetry(appointmentId: string) {
  retryListeners.forEach(listener => listener(appointmentId));
}

export function subscribeRecapRetry(listener: (appointmentId: string) => void) {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}
