/** Serialize complete source transactions, not only their leave prompts. */
export function createEntryArbiter() {
  let tail = Promise.resolve();
  let generation = 0;
  return {
    run<T>(operation: (current: () => boolean) => Promise<T>): Promise<T> {
      const owner = generation;
      const next = tail.then(() => operation(() => owner === generation));
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    invalidate() {
      generation += 1;
    },
  };
}
