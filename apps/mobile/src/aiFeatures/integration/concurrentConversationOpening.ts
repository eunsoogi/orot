import type { ExecutionConsentPort } from '@orot/agent-runtime';

/** Serialize exact authorization requests, not model work. A single disclosure surface
 * cannot accept concurrent prompts; no decision or payload is reused by this adapter. */
function queuedConsent(consent: ExecutionConsentPort): ExecutionConsentPort {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    authorize(request) {
      const result = tail.then(() =>
        request.signal.aborted
          ? ('renewal_required' as const)
          : consent.authorize(request),
      );
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Overlap an optional reviewed opening with the final task after local preparation.
 * Final result delivery waits for the opening; its wall-clock cap includes consent waiting.
 * Stop cancels both through the caller's signal. The cap cancels only the opening,
 * never authorizes or cancels the independently protected final task. */
export async function withConcurrentConversationOpening<T>(input: {
  consent: ExecutionConsentPort;
  signal: AbortSignal;
  open: (consent: ExecutionConsentPort, signal: AbortSignal) => Promise<void>;
  run: (consent: ExecutionConsentPort) => Promise<T>;
  openingTimeoutMs?: number;
  onTimeout?: () => void;
}): Promise<T> {
  const consent = queuedConsent(input.consent);
  const controller = new AbortController();
  const stop = () => controller.abort();
  input.signal.addEventListener('abort', stop, { once: true });
  if (input.signal.aborted) stop();
  const stopped = new Promise<void>(resolve => {
    if (controller.signal.aborted) resolve();
    else
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      });
  });
  const timer = setTimeout(() => {
    stop();
    try {
      input.onTimeout?.();
    } catch {
      /* Optional diagnostics cannot affect settlement. */
    }
  }, input.openingTimeoutMs ?? 10_000);
  // Opening failure is optional; the final task still propagates its original failure.
  const opening = Promise.resolve()
    .then(() => input.open(consent, controller.signal))
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
  try {
    const result = await input.run(consent);
    await Promise.race([opening, stopped]);
    return result;
  } finally {
    clearTimeout(timer);
    stop();
    input.signal.removeEventListener('abort', stop);
  }
}
