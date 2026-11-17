import type { PublicWebSearch } from '@orot/model-runtime';

/** Only this local deadline, not caller cancellation, permits a known lookup limitation. */
export class PublicWebSearchTimeoutError extends Error {}

/** Allow the selected ChatGPT transport's 180-second request window instead of
 * preempting legitimate hosted search at 30 seconds. This watchdog still bounds
 * an unresponsive bridge; Stop/OS cancellation remains immediate and no retry is made.
 * The deadline starts after disclosure, never while waiting for consent. */
export async function boundedPublicWebRequest(
  search: PublicWebSearch,
  query: string,
  parentSignal: AbortSignal,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: ((error: Error) => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const abort = (error = new Error('Public web search stopped.')) => {
    // Settle the deadline first: abort-responsive providers may reject synchronously.
    rejectStop?.(error);
    controller.abort();
  };
  const cancel = () => abort();
  if (parentSignal.aborted) cancel();
  else parentSignal.addEventListener('abort', cancel, { once: true });
  try {
    if (parentSignal.aborted) return await stop;
    timeout = setTimeout(
      () =>
        abort(new PublicWebSearchTimeoutError('Public web search timed out.')),
      180_000,
    );
    return await Promise.race([
      search({ query }, { signal: controller.signal }),
      stop,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal.removeEventListener('abort', cancel);
  }
}
