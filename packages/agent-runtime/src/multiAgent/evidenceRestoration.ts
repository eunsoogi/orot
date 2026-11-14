import { deferEvidenceAdapter } from './modelCallFreshness';
import type { EvidenceBatch, EvidenceReference } from './evidenceContracts';
import type { MultiAgentWorkflowOptions } from './contracts';
import { observeUntilAbort } from './operationObservation';
import { referencesFromBatch, sameReference, validateEvidenceBatch } from './evidence';

export interface EvidenceRestoration {
  readonly restoreEvidence?: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<EvidenceBatch>;
  /** Ordered protected batches retain per-page coverage. Each batch and the union are checked anew. */
  readonly restoreEvidenceBatches?: (
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ) => Promise<readonly EvidenceBatch[]>;
}

/** Validate original page contracts individually, then global item budget/uniqueness and exact order.
 * Per-page returnedCount must not be rewritten to the accumulated count or lose its opaque cursor. */
export async function restoreOrderedEvidenceBatches<T>(
  options: MultiAgentWorkflowOptions<T>,
  references: readonly EvidenceReference[],
  signal: AbortSignal,
): Promise<EvidenceBatch | undefined> {
  const observed = await observeUntilAbort(
    deferEvidenceAdapter(signal, () => options.restoreEvidenceBatches!(references, signal)),
    signal,
  );
  if (observed.kind !== 'value' || signal.aborted) return undefined;
  const batches = observed.value;
  if (
    !Array.isArray(batches) ||
    !batches.length ||
    batches.length > options.execution.budget.maxToolCalls + 1 ||
    batches.some((batch) =>
      validateEvidenceBatch(batch, options.execution.allowedScope, options.execution.budget),
    )
  )
    return undefined;
  const combined = {
    items: batches.flatMap((batch) => batch.items),
    coverage: batches.flatMap((batch) => batch.coverage),
    conflicts: batches.flatMap((batch) => batch.conflicts),
  };
  // Coverage was validated above in its original batch. This second check enforces global item invariants only.
  if (
    validateEvidenceBatch(
      { ...combined, coverage: [] },
      options.execution.allowedScope,
      options.execution.budget,
    )
  )
    return undefined;
  const current = referencesFromBatch(combined);
  return current.length === references.length &&
    current.every((item, index) => sameReference(item, references[index]!))
    ? combined
    : undefined;
}
