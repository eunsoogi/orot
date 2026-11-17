import type { MultiAgentBudget } from './contracts';

/** A page-size budget must not become a lifetime quota for selected/report evidence.
 * Interactive runs retain every validated page; finite legacy invocations keep their exact quota. */
export function exceedsEvidenceCapacity(budget: MultiAgentBudget, count: number): boolean {
  return (
    budget.executionLimits !== 'unbounded' &&
    budget.maxAccumulatedEvidenceItems !== null &&
    count > budget.maxEvidenceItems
  );
}

/** Retrieval stays paged even when the conversation may accumulate multiple pages. */
export function evidenceSearchCapacity(budget: MultiAgentBudget, count: number): number {
  return budget.executionLimits === 'unbounded' || budget.maxAccumulatedEvidenceItems === null
    ? budget.maxEvidenceItems
    : Math.max(0, budget.maxEvidenceItems - count);
}
