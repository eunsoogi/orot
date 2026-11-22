import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createCredentialMutationOwner } from '../../../agent/execution/credentialMutation';

/** Synthetic stand-in for settings approval bound to one exact request and owner. */
export function dailyReportAtomicSaveConsent(
  refused: boolean,
  remoteLive: boolean,
) {
  let authorized: OutboundProcessingRequest | undefined;
  const selection = createCredentialMutationOwner();
  const current = selection.capture();
  if (!current) throw new Error('Missing synthetic selection witness.');
  const auth = jest.fn(async (request?: OutboundProcessingRequest) => {
    authorized = request;
    return refused ? ('renewal_required' as const) : ('authorized' as const);
  });
  const isAuthorizationCurrent = (request: OutboundProcessingRequest) =>
    request === authorized && !request.signal.aborted && current();
  return {
    auth,
    switchSelection: () => selection.begin()(),
    selectionWitness: { isCurrent: current, subscribe: selection.subscribe },
    live: remoteLive
      ? {
          isAuthorizationCurrent,
          subscribeAuthorizationInvalidation: (
            request: OutboundProcessingRequest,
            listener: () => void,
          ) =>
            selection.subscribe(() => {
              if (!isAuthorizationCurrent(request)) listener();
            }),
        }
      : undefined,
  };
}
