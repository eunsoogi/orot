/** Manage subscriptions independently from conversation state transitions. */
export function createConversationListeners() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach(listener => listener()),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
