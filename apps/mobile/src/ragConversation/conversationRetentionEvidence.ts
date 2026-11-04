import type { EvidenceReference } from '@orot/agent-runtime';
import type { RagConversationOutcome } from './outcome';

/** Capture only validated, uncancelled answers; observation must not change the displayed result. */
export function trackValidatedEvidence(
  references: readonly EvidenceReference[] | undefined,
  observer?: (references: readonly EvidenceReference[]) => void,
  signal?: AbortSignal,
) {
  return (outcome: RagConversationOutcome): RagConversationOutcome => {
    if (
      outcome.status === 'answer' &&
      !signal?.aborted &&
      Array.isArray(references)
    ) {
      try {
        observer?.(references);
      } catch {
        /* An observer cannot change a validated answer. */
      }
    }
    return outcome;
  };
}
