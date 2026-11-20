import { isExecutionConsentCurrent } from '@orot/agent-runtime';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';

/** Retained UI callbacks may change, but an approved request never adopts another port's grant. */
export function retainedVisitConsent(
  read: () => ExecutionConsentPort | undefined,
): ExecutionConsentPort {
  const owners = new WeakMap<OutboundProcessingRequest, ExecutionConsentPort>();
  const current = (request: OutboundProcessingRequest) => {
    const owner = owners.get(request);
    return (
      !!owner &&
      owner === read() &&
      !request.signal.aborted &&
      isExecutionConsentCurrent(owner, request)
    );
  };
  return {
    async authorize(request) {
      owners.delete(request);
      const owner = read();
      if (!owner || request.signal.aborted) return 'renewal_required';
      const result = await owner.authorize(request);
      if (result !== 'authorized' || owner !== read() || request.signal.aborted)
        return 'renewal_required';
      owners.set(request, owner);
      return current(request) ? 'authorized' : 'renewal_required';
    },
    isAuthorizationCurrent: current,
    subscribeAuthorizationInvalidation(request, invalidated) {
      const owner = owners.get(request);
      if (!owner || !current(request)) {
        invalidated();
        return () => {};
      }
      const stop =
        owner.subscribeAuthorizationInvalidation?.(request, invalidated) ??
        (() => {});
      if (!current(request)) invalidated();
      return stop;
    },
  };
}
