import { wrapEvidenceSearch } from './wrapEvidenceSearch';
import type {
  EvidenceBatch,
  EvidenceReference,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { stableJson } from './evidenceUtils';
import { stableEvidenceReference } from './stableEvidenceReference';

/** Retains exact batches; protected snapshots never authorize transmission or rerun a search. */
export function conversationWorkflowEvidenceCache<T>(
  options: MultiAgentWorkflowOptions<T>,
  restored?: readonly EvidenceBatch[],
) {
  const items = new Map<string, EvidenceBatch['items'][number]>();
  const batches: EvidenceBatch[] = [];
  const remember = (value: EvidenceBatch) => {
    // Protected storage sorts object keys. Normalize before the first provider request too,
    // so JSON embedded inside task message strings stays identical after reconstruction.
    const batch: EvidenceBatch = JSON.parse(stableJson(value));
    batches.push(batch);
    batch.items.forEach(item => items.set(stableEvidenceReference(item), item));
    return batch;
  };
  if (restored) {
    if (
      !Array.isArray(restored) ||
      !restored.length ||
      stableJson(restored[0]) !== stableJson(options.initialEvidence) ||
      stableJson(restored).length > 2_000_000 ||
      restored.some(
        batch =>
          !batch ||
          !Array.isArray(batch.items) ||
          !Array.isArray(batch.coverage) ||
          !Array.isArray(batch.conflicts),
      )
    )
      throw new Error('Invalid protected evidence snapshot.');
    // Provenance/source freshness comes from the reconstructed adapters and runtime,
    // not from accepting a serialized batch here. Never substitute a new search.
    (JSON.parse(JSON.stringify(restored)) as EvidenceBatch[]).forEach(remember);
  } else remember(options.initialEvidence);
  return {
    ...options,
    initialEvidence: batches[0]!,
    ...(options.context
      ? { context: JSON.parse(stableJson(options.context)) }
      : {}),
    /** Private storage only; copy so later callers cannot mutate the live owner. */
    snapshotEvidence(): readonly EvidenceBatch[] {
      return JSON.parse(JSON.stringify(batches));
    },
    tools: options.tools.map(tool =>
      wrapEvidenceSearch(tool, async (_request, _runtime, dispatch) => {
        const result = await dispatch();
        return 'items' in result ? remember(result) : result;
      }),
    ),
    async restoreEvidenceBatches(
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ): Promise<readonly EvidenceBatch[]> {
      const original = batches.flatMap(batch => batch.items);
      if (
        signal.aborted ||
        original.length !== references.length ||
        original.some(
          (item, index) =>
            stableEvidenceReference(item) !==
            stableEvidenceReference(references[index]!),
        )
      )
        throw new Error('Original ordered evidence batches are unavailable.');
      return JSON.parse(JSON.stringify(batches));
    },
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
          // Zero-result batches carry real search limitations even without a citation.
          ...new Set([
            ...references.map(reference => reference.sourceKind),
            ...batches
              .filter(batch => batch.items.length === 0)
              .flatMap(batch => batch.coverage.map(value => value.sourceKind)),
          ]),
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
