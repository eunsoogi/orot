import type { MultiAgentBudget } from './contracts';

/** A page-size budget must not become a lifetime quota for selected/report evidence.
 * Call counts and each incoming batch remain bounded; old invocations keep their exact quota. */
export function exceedsEvidenceCapacity(budget: MultiAgentBudget, count: number): boolean {
  return budget.maxAccumulatedEvidenceItems !== null && count > budget.maxEvidenceItems;
}

/** Retrieval stays paged even when the conversation may accumulate multiple pages. */
export function evidenceSearchCapacity(budget: MultiAgentBudget, count: number): number {
  return budget.maxAccumulatedEvidenceItems === null
    ? budget.maxEvidenceItems
    : Math.max(0, budget.maxEvidenceItems - count);
}
