import type { PublicWebSearch } from '@orot/model-runtime';

/** Bound network work after disclosure; waiting for a person's consent has no deadline. */
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
  const abort = () => {
    controller.abort();
    rejectStop?.(new Error('Public web search stopped.'));
  };
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener('abort', abort, { once: true });
  try {
    if (parentSignal.aborted) return await stop;
    timeout = setTimeout(abort, 30_000);
    return await Promise.race([
      search({ query }, { signal: controller.signal }),
      stop,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abort);
  }
}
