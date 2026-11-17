/** Finite callers can bound optional preview processing, never authorization or local preflight.
 * Each resume uses the remaining budget; consent cannot reset spent model time. */
export function createInitialReplyDeadline(abort: () => void, durationMs: number | null) {
  let remaining = durationMs ?? 0;
  let started = Date.now();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined =
    durationMs === null ? undefined : setTimeout(abort, remaining);
  return {
    pause() {
      if (disposed || timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - Math.max(0, Date.now() - started));
    },
    resume() {
      if (disposed || timer !== undefined || durationMs === null) return;
      if (remaining <= 0) {
        abort();
        return;
      }
      started = Date.now();
      timer = durationMs === null ? undefined : setTimeout(abort, remaining);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
