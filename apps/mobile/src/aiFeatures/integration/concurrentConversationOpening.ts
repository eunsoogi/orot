import { createInitialReplyDeadline } from '@orot/agent-runtime';
import type { ExecutionConsentPort } from '@orot/agent-runtime';

/** Serialize exact authorization requests, not model work. A single disclosure surface
 * cannot accept concurrent prompts; no decision or payload is reused by this adapter. */
function queuedConsent(
  consent: ExecutionConsentPort,
  deadline: ReturnType<typeof createInitialReplyDeadline>,
): ExecutionConsentPort {
  let tail: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  return {
    authorize(request) {
      waiting++;
      deadline.pause();
      const result = tail.then(() =>
        request.signal.aborted
          ? ('renewal_required' as const)
          : consent.authorize(request),
      );
      tail = result.catch(() => undefined);
      return result.finally(() => {
        waiting--;
        if (!waiting) deadline.resume();
      });
    },
  };
}

/** Overlap an optional reviewed opening with the final task after local preparation.
 * Final delivery waits for opening settlement; only processing spends the time cap.
 * Queued and visible authorization waits pause it, never dismissing a user decision.
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
  const deadline = createInitialReplyDeadline(() => {
    stop();
    try {
      input.onTimeout?.();
    } catch {
      /* Optional diagnostics cannot affect settlement. */
    }
  }, input.openingTimeoutMs ?? 10_000);
  const consent = queuedConsent(input.consent, deadline);
  // Opening failure is optional; the final task still propagates its original failure.
  const opening = Promise.resolve()
    .then(() => input.open(consent, controller.signal))
    .catch(() => undefined)
    .finally(() => deadline.dispose());
  try {
    const result = await input.run(consent);
    await Promise.race([opening, stopped]);
    return result;
  } finally {
    deadline.dispose();
    stop();
    input.signal.removeEventListener('abort', stop);
  }
}
