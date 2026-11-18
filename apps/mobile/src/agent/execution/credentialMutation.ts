/** A credential write invalidates live requests before its first asynchronous step.
 * Failed writes may leave the previous credential usable for a new explicit lookup,
 * but must never resurrect an already-issued transmission witness. No secret is held. */
export function createCredentialMutationOwner() {
  let revision = 0;
  let pending = 0;
  const listeners = new Set<() => void>();
  return {
    capture(): (() => boolean) | null {
      if (pending) return null;
      const captured = revision;
      return () => pending === 0 && revision === captured;
    },
    begin() {
      revision += 1;
      pending += 1;
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* Observer failure cannot prevent credential removal. */
        }
      }
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        pending -= 1;
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
