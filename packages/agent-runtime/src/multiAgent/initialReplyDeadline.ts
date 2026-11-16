/** Bound optional preview processing, not authorization or its local-preflight gate.
 * Each resume uses the remaining budget; consent cannot reset spent model time. */
export function createInitialReplyDeadline(abort: () => void, durationMs: number) {
  let remaining = durationMs;
  let started = Date.now();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(abort, remaining);
  return {
    pause() {
      if (disposed || timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - Math.max(0, Date.now() - started));
    },
    resume() {
      if (disposed || timer !== undefined) return;
      if (remaining <= 0) {
        abort();
        return;
      }
      started = Date.now();
      timer = setTimeout(abort, remaining);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
