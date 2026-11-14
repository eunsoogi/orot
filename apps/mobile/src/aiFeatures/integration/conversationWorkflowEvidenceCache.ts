import { wrapEvidenceSearch } from './wrapEvidenceSearch';
import type {
  EvidenceBatch,
  EvidenceReference,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { stableJson } from './evidenceUtils';
import { stableEvidenceReference } from './stableEvidenceReference';

/** Keeps the original validated input in memory; a missing alias is never recovered by rerunning a tool. */
export function conversationWorkflowEvidenceCache<T>(
  options: MultiAgentWorkflowOptions<T>,
) {
  const items = new Map<string, EvidenceBatch['items'][number]>();
  const batches: EvidenceBatch[] = [];
  const remember = (batch: EvidenceBatch) => {
    batches.push(batch);
    batch.items.forEach(item => items.set(stableEvidenceReference(item), item));
    return batch;
  };
  remember(options.initialEvidence);
  return {
    ...options,
    tools: options.tools.map(tool =>
      wrapEvidenceSearch(tool, async (_request, _runtime, dispatch) => {
        const result = await dispatch();
        return 'items' in result ? remember(result) : result;
      }),
    ),
    async restoreEvidence(
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ): Promise<EvidenceBatch> {
      if (
        signal.aborted ||
        references.some(
          reference => !items.has(stableEvidenceReference(reference)),
        )
      )
        throw new Error('Original evidence is not available for continuation.');
      // Runtime separately revalidates each exact revision before this cached content can be used.
      return {
        items: references.map(reference =>
          items.get(stableEvidenceReference(reference))!,
        ),
        coverage: [
          ...new Set(references.map(reference => reference.sourceKind)),
        ].map(sourceKind => {
          const original = batches
            .flatMap(batch => batch.coverage)
            .filter(value => value.sourceKind === sourceKind);
          const ranges = new Set(
            original.map(value => stableJson(value.requestedTimeRange ?? null)),
          );
          if (ranges.size > 1)
            throw new Error('Evidence scope changed between saved batches.');
          const count = references.filter(
            reference => reference.sourceKind === sourceKind,
          ).length;
          return {
            sourceKind,
            searchedSourceIds: [
              ...new Set(original.flatMap(value => value.searchedSourceIds)),
            ],
            ...(original[0]?.requestedTimeRange
              ? { requestedTimeRange: original[0].requestedTimeRange }
              : {}),
            gaps: [...new Set(original.flatMap(value => value.gaps))],
            truncated: original.some(value => value.truncated),
            // These counts describe the retained union, not a new search or a fabricated complete history.
            resultLimit: options.execution.budget.maxEvidenceItems,
            returnedCount: count,
          };
        }),
        conflicts: [...new Set(batches.flatMap(batch => batch.conflicts))],
      };
    },
  };
}
