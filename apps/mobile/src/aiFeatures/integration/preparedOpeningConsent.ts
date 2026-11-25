import type { Feature } from '../../providers/diagnosticTypes';
import { reportOpening } from './openingObservation';
import { startRagConversationOpening } from './contextualConversationOpening';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { ConversationEntryContext } from './conversationIntent';

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
    ...(consent.subscribeAuthorizationInvalidation
      ? {
          subscribeAuthorizationInvalidation:
            consent.subscribeAuthorizationInvalidation.bind(consent),
        }
      : {}),
    ...(consent.isAuthorizationCurrent
      ? { isAuthorizationCurrent: consent.isAuthorizationCurrent.bind(consent) }
      : {}),
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
type RagOpeningArgs = Parameters<typeof startRagConversationOpening>;
export function startPreparedRagOpening(
  selected: RagOpeningArgs[0],
  request: string,
  observer: RagOpeningArgs[2],
  consent: ExecutionConsentPort,
  signal: AbortSignal,
  context: {
    readonly current?: RagOpeningArgs[5];
    readonly entryContext?: ConversationEntryContext;
  },
) {
  const gate = createPreparedOpeningConsent(consent);
  const intent = context.entryContext?.intent;
  const allowA2UI =
    (!intent || intent === 'conversation') &&
    !context.current &&
    !observer?.selectedRecordingTranscript &&
    !observer?.expectedVoiceSelection &&
    !observer?.photoInput;
  const opening = startRagConversationOpening(
    selected,
    request,
    observer,
    gate.port,
    signal,
    context.current,
    allowA2UI,
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
