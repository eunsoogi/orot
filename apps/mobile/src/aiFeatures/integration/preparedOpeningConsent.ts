import type { Feature } from '../../providers/diagnosticTypes';
import { reportOpening } from './openingObservation';
import { startRagConversationOpening } from './contextualConversationOpening';
import type { ExecutionConsentPort } from '@orot/agent-runtime';

/** The optional opening owns no user prompt until local preflight succeeds.
 * Failure closes only this gate; it never approves, reuses or dismisses another request. */
export function createPreparedOpeningConsent(
  consent: ExecutionConsentPort,
  feature?: Feature,
) {
  let settle!: (ready: boolean) => void;
  let settled = false;
  reportOpening('opening_preflight', 'started', feature);
  const ready = new Promise<boolean>(resolve => {
    settle = resolve;
  });
  const port: ExecutionConsentPort = {
    async authorize(request) {
      if (!(await ready) || request.signal.aborted) return 'renewal_required';
      return consent.authorize(request);
    },
  };
  return {
    port,
    release(value: boolean) {
      if (settled) return;
      settled = true;
      reportOpening(
        'opening_preflight',
        value ? 'completed' : 'failed',
        feature,
      );
      settle(value);
    },
  };
}

/** Start an opening with its own local-preparation gate; cleanup always releases waiters. */
export function startPreparedRagOpening(
  ...args: Parameters<typeof startRagConversationOpening>
) {
  const gate = createPreparedOpeningConsent(args[3]);
  const opening = startRagConversationOpening(
    args[0],
    args[1],
    args[2],
    gate.port,
    args[4],
    args[5],
  );
  return {
    done: opening.done,
    ready: () => gate.release(true),
    dispose() {
      gate.release(false);
      opening.dispose();
    },
  };
}
