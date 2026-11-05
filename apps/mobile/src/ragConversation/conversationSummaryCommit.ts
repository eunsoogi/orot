import type { PendingTurn } from './conversationSessionTypes';

/** Track the summary transaction separately from the conversation transaction. */
export function observeSummaryCommit(turn: PendingTurn) {
  return {
    onSummarySaveStart() {
      turn.summarySaving = true;
    },
    onSummarySaveSettled(committed: boolean) {
      turn.summarySaving = false;
      turn.summaryCommitted = committed;
    },
  };
}
