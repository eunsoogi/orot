/** Retains failed cleanup work so a database fence is always retried before native deletion. */
export function createConversationPhotoRetirement(input: {
  readonly fence: (sourceId: string) => Promise<void>;
  readonly discard: (sourceId: string) => Promise<void>;
  readonly changed?: () => void;
}) {
  const pending = new Set<string>();
  const active = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const changed = () => {
    try {
      input.changed?.();
    } catch {
      // A detached view must not interrupt ownership cleanup.
    }
    listeners.forEach(listener => listener());
  };
  const retire = (sourceId: string): Promise<void> => {
    const current = active.get(sourceId);
    if (current) return current;
    pending.add(sourceId);
    const work = Promise.resolve().then(async () => {
      try {
        await input.fence(sourceId);
        await input.discard(sourceId);
        pending.delete(sourceId);
      } finally {
        active.delete(sourceId);
        changed();
      }
    });
    active.set(sourceId, work);
    changed();
    return work;
  };
  return {
    retire,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pending: () => [...pending],
    isActive: (sourceId: string) => active.has(sourceId),
  };
}
