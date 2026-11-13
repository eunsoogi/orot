/** Legacy callers without an app-entry arbiter retain their original immediate execution. */
export async function executeReminderWork(
  work: () => Promise<void>,
): Promise<void> {
  await work();
}

/** Serialize daily work independently; failed cleanup waits for a later lifecycle or route change. */
export function createDailyReminderDrain(input: {
  cleanup: () => Promise<boolean>;
  restore: () => Promise<string>;
  shouldRestore?: () => Promise<boolean>;
  deliver: () => Promise<void | boolean>;
  onBusy: () => void;
  onClosed: () => void;
}) {
  let queue = Promise.resolve();
  let restorePending = true;
  return () => {
    queue = queue
      .then(async () => {
        let closed: boolean;
        try {
          closed = await input.cleanup();
        } catch {
          return;
        }
        if (closed) input.onClosed();
        // A new user tap takes priority over restoring a previously active destination.
        if ((await input.deliver()) === false) return;
        if (
          restorePending &&
          (!input.shouldRestore || (await input.shouldRestore()))
        ) {
          const result = await input.restore();
          if (result === 'busy') {
            input.onBusy();
            return;
          }
          restorePending = false;
        }
      })
      .catch(() => undefined);
    return queue;
  };
}
