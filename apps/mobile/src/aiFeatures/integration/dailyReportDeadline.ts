/** Bound preparation as well as inference; a late operation cannot publish after abort. */
export async function boundedDailyReport<T>(
  signal: AbortSignal,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<
  T | { status: 'failed'; code: 'cancelled' | 'timeout' | 'source_unavailable' }
> {
  if (signal.aborted) return { status: 'failed', code: 'cancelled' };
  const controller = new AbortController();
  let timedOut = false;
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => {
    stop = resolve;
  });
  const abort = () => {
    controller.abort();
    stop();
  };
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, timeoutMs);
  try {
    const result = await Promise.race([
      work(controller.signal),
      stopped.then(() => ({
        status: 'failed' as const,
        code: timedOut ? ('timeout' as const) : ('cancelled' as const),
      })),
    ]);
    return timedOut
      ? { status: 'failed', code: 'timeout' }
      : signal.aborted
        ? { status: 'failed', code: 'cancelled' }
        : result;
  } catch {
    return {
      status: 'failed',
      code: timedOut
        ? 'timeout'
        : signal.aborted
          ? 'cancelled'
          : 'source_unavailable',
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
