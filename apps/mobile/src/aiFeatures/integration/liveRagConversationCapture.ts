import { prepareConversationContinuation } from './prepareConversationContinuation';
import type { ConversationColdReconstruction } from '../../storage/conversationContinuationCapture';
import { captureColdRagConversationState } from './coldRagConversationState';
import type { ConversationEntryContext } from './conversationIntent';
import type { FreshConversationHistory } from './freshConversationDialogue';
import type { EvidenceReference } from '@orot/agent-runtime';

type State = Parameters<typeof captureColdRagConversationState>[0];
/** A live-only closure captures exact completion inputs, not a function or reusable consent grant. */
export function liveRagConversationCapture(
  state: Pick<
    State,
    'registry' | 'tracker' | 'external' | 'signal' | 'sessionId'
  >,
  completion: () => {
    history: FreshConversationHistory;
    entryContext?: ConversationEntryContext;
    reportReferences: readonly EvidenceReference[];
    localRetrievalFailed: boolean;
    hasPagingState: boolean;
    artifactPaging?: () => import('./artifactPagingSnapshot').ArtifactPagingSnapshot;
    researchPaging?: (
      operationRunId: string,
    ) => import('./researchPagingState').ResearchPagingSnapshot;
    publicSearch?: import('./coldConversationSearch').ColdConversationSearch;
  },
): ConversationColdReconstruction {
  return async input => {
    const saved = completion();
    // Preserve all token and chooser state together; otherwise refuse recovery.
    if (
      (saved.hasPagingState && !saved.artifactPaging) ||
      !input.evidenceBatches
    )
      throw new Error('Cold paging or evidence reconstruction unavailable.');
    const reconstruction = await captureColdRagConversationState({
      ...state,
      options: input.options,
      artifactPaging: saved.artifactPaging?.(),
      researchPaging: saved.researchPaging?.(
        input.options.execution.operationRunId,
      ),
      batches: input.evidenceBatches,
      knownCallIds: input.knownCallIds,
      sessionId: state.sessionId,
      operationRunId: input.options.execution.operationRunId,
    });
    return {
      ...reconstruction,
      ...(saved.publicSearch
        ? { publicSearch: { ...saved.publicSearch } }
        : {}),
      completion: JSON.parse(
        JSON.stringify({
          version: saved.history.historicalDialogueParents ? 2 : 1,
          ...(saved.history.historicalDialogueParents
            ? {
                historicalDialogueParents:
                  saved.history.historicalDialogueParents,
              }
            : {}),
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
