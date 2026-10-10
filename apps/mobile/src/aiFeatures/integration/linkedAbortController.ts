export interface LinkedAbortController {
  readonly controller: AbortController;
  readonly dispose: () => void;
}

/** Propagates route teardown and removes the parent listener when work settles. */
export function createLinkedAbortController(
  parentSignal?: AbortSignal,
): LinkedAbortController {
  const controller = new AbortController();
  if (!parentSignal) return { controller, dispose: () => undefined };

  const abort = () => controller.abort();
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener('abort', abort, { once: true });

  return {
    controller,
    dispose: () => parentSignal.removeEventListener('abort', abort),
  };
}
