/** A failing view must not interrupt protected-file ownership transitions. */
export function notifyPhotoListeners(listeners: Set<() => void>) {
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // Continue notifying other views and completing the file operation.
    }
  });
}
