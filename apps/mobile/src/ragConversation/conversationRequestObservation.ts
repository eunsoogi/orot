type Stage =
  | 'dispatch'
  | 'dispatch-rejected'
  | 'preflight-started'
  | 'preflight-stopped'
  | 'preflight-ready'
  | 'preflight-error'
  | 'request-accepted'
  | 'request-rejected'
  | 'sender-invoked'
  | 'selection-required'
  | 'provider-configuration'
  | 'other-outcome';

let sink: ((stage: Stage) => void) | undefined;

/** A synthetic test entry owns the sink and removes it when its session unmounts. */
export function registerConversationRequestObservation(
  next: (stage: Stage) => void,
) {
  sink = next;
  return () => {
    if (sink === next) sink = undefined;
  };
}

/** Fixed structural stages carry no question, provider, session or user identifiers. */
export function observeConversationRequest(stage: Stage) {
  try {
    sink?.(stage);
  } catch {
    // Diagnostics must never change request behavior.
  }
}
