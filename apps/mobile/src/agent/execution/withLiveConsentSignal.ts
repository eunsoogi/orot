import { isExecutionConsentCurrent } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';

/** A non-model transport receives its own revocable signal; subscriptions end with
 * the one dispatch and a revoked request can never publish a late transport result. */
export async function withLiveConsentSignal<T>(
  consent: ExecutionConsentPort,
  request: OutboundProcessingRequest,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  let stop = () => {};
  const current = () =>
    !request.signal.aborted &&
    !controller.signal.aborted &&
    isExecutionConsentCurrent(consent, request);
  try {
    stop = consent.subscribeAuthorizationInvalidation?.(request, abort) ?? stop;
    if (!current()) throw new Error('Transmission permission changed');
    const value = await operation(controller.signal);
    if (!current()) throw new Error('Transmission permission changed');
    return value;
  } finally {
    request.signal.removeEventListener('abort', abort);
    stop();
  }
}
