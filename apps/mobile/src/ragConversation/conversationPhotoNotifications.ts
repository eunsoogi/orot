/** A failing view must not interrupt protected-file ownership transitions. */
export function createPhotoNotifications() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      listeners.forEach(listener => {
        try {
          listener();
        } catch {
          // Continue notifying other views and completing the file operation.
        }
      });
    },
  };
}
