import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import type { OnDeviceSelectionWitness } from './provider';

/** A local proof can use only the original successful dispatch's still-live authorization. */
export function createDailyReportDispatchAuthority() {
  let witness: OnDeviceSelectionWitness | undefined;
  let release: (() => void) | undefined;
  const dispose = () => {
    witness = undefined;
    release?.();
    release = undefined;
  };
  return {
    get witness() {
      return witness;
    },
    retain(
      consent: ExecutionConsentPort,
      request: OutboundProcessingRequest,
      exact: () => boolean,
      cleanup: () => void,
    ) {
      const subscribe = consent.subscribeAuthorizationInvalidation;
      // A legacy approval cannot prove the grant or account is still current.
      const proven = () => {
        try {
          return exact();
        } catch {
          return false;
        }
      };
      if (!subscribe || !consent.isAuthorizationCurrent || !proven())
        return false;
      dispose();
      release = cleanup;
      const current: OnDeviceSelectionWitness = {
        isCurrent: () => witness === current && proven(),
        subscribe: listener => subscribe.call(consent, request, listener),
      };
      witness = current;
      return true;
    },
    dispose,
  };
}

export type DailyReportDispatchAuthority = ReturnType<
  typeof createDailyReportDispatchAuthority
>;
