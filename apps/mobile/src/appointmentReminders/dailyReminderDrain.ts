/** Serialize daily work independently; failed cleanup waits for a later lifecycle or route change. */
export function createDailyReminderDrain(input: {
  cleanup: () => Promise<boolean>;
  restore: () => Promise<string>;
  shouldRestore?: () => Promise<boolean>;
  deliver: () => Promise<void>;
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
        await input.deliver();
      })
      .catch(() => undefined);
    return queue;
  };
}
