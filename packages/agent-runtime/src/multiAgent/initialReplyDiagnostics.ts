/** Closed observation tokens only; never include requests, candidates, identities or errors. */
export type InitialReplyStage =
  'opening_generate' | 'opening_validate' | 'opening_review' | 'opening_consent';
export type InitialReplyOutcome =
  | 'started'
  | 'completed'
  | 'invalid_output'
  | 'consent_required'
  | 'unavailable'
  | 'budget_exceeded'
  | 'timeout'
  | 'cancelled'
  | 'stale_evidence'
  | 'failed';
export type InitialReplyObserver = (
  stage: InitialReplyStage,
  outcome: InitialReplyOutcome,
) => void | Promise<void>;

/** Diagnostics are best-effort and cannot delay or change authorization, output or cancellation. */
export function reportInitialReply(
  observer: InitialReplyObserver | undefined,
  stage: InitialReplyStage,
  outcome: InitialReplyOutcome,
) {
  try {
    const pending = observer?.(stage, outcome);
    if (pending) Promise.resolve(pending).catch(() => undefined);
  } catch {
    // No observer failure is promoted into a model or task failure.
  }
}
