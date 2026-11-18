import { isExecutionConsentCurrent } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';

/** Foreground ownership is independent of the saved grant. Route removal revokes
 * in-flight recap transmission even when the same account remains approved. */
export function createRecapForegroundConsent() {
  let foreground: ExecutionConsentPort | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  const witnesses = new WeakMap<
    OutboundProcessingRequest,
    { surface: ExecutionConsentPort; revision: number }
  >();
  const current = (request: OutboundProcessingRequest) => {
    if (!request.remoteProcessing) return !request.signal.aborted;
    const witness = witnesses.get(request);
    return Boolean(
      witness &&
      witness.surface === foreground &&
      witness.revision === revision &&
      isExecutionConsentCurrent(witness.surface, request),
    );
  };
  const consent: ExecutionConsentPort = {
    isAuthorizationCurrent: current,
    subscribeAuthorizationInvalidation(request, listener) {
      if (!request.remoteProcessing) return () => {};
      const witness = witnesses.get(request);
      if (!witness || !current(request)) {
        listener();
        return () => {};
      }
      const check = () => {
        if (!current(request)) listener();
      };
      listeners.add(check);
      const stop = witness.surface.subscribeAuthorizationInvalidation?.(
        request,
        check,
      );
      return () => {
        listeners.delete(check);
        stop?.();
      };
    },
    async authorize(request) {
      if (!request.remoteProcessing) return 'authorized';
      witnesses.delete(request);
      const surface = foreground;
      const capturedRevision = revision;
      if (!surface) return 'renewal_required';
      const decision = await surface.authorize(request);
      if (foreground !== surface || revision !== capturedRevision)
        return 'renewal_required';
      if (decision === 'authorized')
        witnesses.set(request, { surface, revision });
      return decision;
    },
  };
  return {
    consent,
    set(surface: ExecutionConsentPort | null) {
      if (foreground === surface) return;
      foreground = surface;
      ++revision;
      for (const listener of listeners) listener();
    },
  };
}
