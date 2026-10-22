import { MAX_MULTI_AGENT_BUDGET } from './contracts';
import type { MultiAgentWorkflowOptions } from './contracts';

/** All count and size limits remain mandatory; only elapsed time accepts an explicit opt-out. */
export function validBudget<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  const keys = Object.keys(MAX_MULTI_AGENT_BUDGET) as (keyof typeof MAX_MULTI_AGENT_BUDGET)[];
  return (
    Object.keys(options.execution.budget).length === keys.length &&
    keys.every((key) => {
      const value = options.execution.budget[key];
      if (key === 'timeoutMs' && value === null) return true;
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= MAX_MULTI_AGENT_BUDGET[key]
      );
    })
  );
}
