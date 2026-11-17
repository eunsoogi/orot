import { MAX_MULTI_AGENT_BUDGET } from './contracts';
import type { MultiAgentWorkflowOptions } from './contracts';

/** Validate host policy and legacy finite hints before dispatch; model input cannot select this policy. */
export function validBudget<TResult>(options: MultiAgentWorkflowOptions<TResult>): boolean {
  const keys = Object.keys(MAX_MULTI_AGENT_BUDGET) as (keyof typeof MAX_MULTI_AGENT_BUDGET)[];
  return (
    (options.execution.budget.executionLimits === undefined ||
      options.execution.budget.executionLimits === 'unbounded') &&
    Object.keys(options.execution.budget).every(
      (key) =>
        key === 'executionLimits' ||
        key === 'maxModelRequestBytes' ||
        key === 'maxAccumulatedEvidenceItems' ||
        keys.includes(key as (typeof keys)[number]),
    ) &&
    (options.execution.budget.maxModelRequestBytes === undefined ||
      options.execution.budget.maxModelRequestBytes === null ||
      (Number.isSafeInteger(options.execution.budget.maxModelRequestBytes) &&
        options.execution.budget.maxModelRequestBytes > 0 &&
        options.execution.budget.maxModelRequestBytes <= MAX_MULTI_AGENT_BUDGET.maxPayloadBytes)) &&
    (options.execution.budget.maxAccumulatedEvidenceItems === undefined ||
      options.execution.budget.maxAccumulatedEvidenceItems === null) &&
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
