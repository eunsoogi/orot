import type { RagConversationOutcome } from './outcome';
import { getRagConversationCopy } from './copy';

/** Resolve the user-visible empty result without treating it as a generated answer. */
export function conversationOutcomeText(outcome: RagConversationOutcome) {
  if (outcome.status === 'answer') return outcome.answer;
  const copy = getRagConversationCopy();
  return outcome.status === 'no_evidence' ? copy.noEvidence : copy.insufficient;
}
