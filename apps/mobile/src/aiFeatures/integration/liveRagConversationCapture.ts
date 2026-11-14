import { prepareConversationContinuation } from './prepareConversationContinuation';
import type { ConversationColdReconstruction } from '../../storage/conversationContinuationCapture';
import { captureColdRagConversationState } from './coldRagConversationState';
import type { ConversationEntryContext } from './conversationIntent';
import type { loadConversationHistory } from './conversationHistorySources';
import type { EvidenceReference } from '@orot/agent-runtime';

type State = Parameters<typeof captureColdRagConversationState>[0];
/** A live-only closure captures exact completion inputs, not a function or reusable consent grant. */
export function liveRagConversationCapture(
  state: Pick<
    State,
    'registry' | 'tracker' | 'external' | 'signal' | 'sessionId'
  >,
  completion: () => {
    history: Awaited<ReturnType<typeof loadConversationHistory>>;
    entryContext?: ConversationEntryContext;
    reportReferences: readonly EvidenceReference[];
    localRetrievalFailed: boolean;
    hasPagingState: boolean;
  },
): ConversationColdReconstruction {
  return async input => {
    const saved = completion();
    // Paging cursors are scoped live handles until an exact protected paging factory exists.
    // Optional capture clears recovery instead of losing pagination or reissuing its search.
    if (saved.hasPagingState || !input.evidenceBatches)
      throw new Error('Cold paging or evidence reconstruction unavailable.');
    const reconstruction = await captureColdRagConversationState({
      ...state,
      options: input.options,
      batches: input.evidenceBatches,
      knownCallIds: input.knownCallIds,
      sessionId: state.sessionId,
      operationRunId: input.options.execution.operationRunId,
    });
    return {
      ...reconstruction,
      completion: JSON.parse(
        JSON.stringify({
          version: 1,
          entryContext: saved.entryContext ?? null,
          priorDialogue: saved.history.priorTurns,
          priorUserReports: saved.history.reports,
          priorDialogueOmitted: saved.history.omitted,
          historySources: saved.history.sources,
          reportReferences: saved.reportReferences,
          localRetrievalFailed: saved.localRetrievalFailed,
        }),
      ),
    };
  };
}

/** Keep the capture closure attached to the same retained owner that opens the graph store. */
export function prepareLiveRagContinuation(
  observer: Parameters<typeof prepareConversationContinuation>[0],
  selected: Parameters<typeof prepareConversationContinuation>[1],
  selectedAi: Parameters<typeof prepareConversationContinuation>[2],
  state: Omit<Parameters<typeof liveRagConversationCapture>[0], 'sessionId'>,
  completion: Parameters<typeof liveRagConversationCapture>[1],
) {
  return prepareConversationContinuation(
    observer,
    selected,
    selectedAi,
    liveRagConversationCapture(
      { ...state, sessionId: observer?.retentionSession?.id ?? '' },
      completion,
    ),
  );
}
