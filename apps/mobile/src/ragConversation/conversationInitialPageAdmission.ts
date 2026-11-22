/** An open permit covers one epoch, not a future return to the same authority.
 * Hold and release change only whether a read may validate, never its owner. */
export function createConversationInitialPageAdmission() {
  let epoch = 0;
  let held = false;
  const waiters = new Set<() => void>();
  return {
    hold() {
      held = true;
      const owner = ++epoch;
      return () => {
        // A late reconciliation must not admit content for a newer tab return.
        if (owner !== epoch || !held) return;
        held = false;
        for (const wake of waiters) wake();
      };
    },
    async wait(signal: AbortSignal): Promise<() => void> {
      while (held && !signal.aborted) {
        await new Promise<void>(resolve => {
          const wake = () => {
            waiters.delete(wake);
            signal.removeEventListener('abort', wake);
            resolve();
          };
          waiters.add(wake);
          signal.addEventListener('abort', wake, { once: true });
        });
      }
      const admitted = epoch;
      const assertCurrent = () => {
        if (signal.aborted || held || admitted !== epoch)
          throw new Error('Conversation restoration was cancelled.');
      };
      assertCurrent();
      return assertCurrent;
    },
  };
}
