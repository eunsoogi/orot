import type { MultiAgentBudget } from './evidenceContracts';

/** Trusted host policy. Infinity is only an in-process comparison sentinel; never serialize it. */
export function executionLimit(
  budget: MultiAgentBudget,
  key: 'maxModelCalls' | 'maxToolCalls' | 'maxResearchCycles' | 'maxPayloadBytes',
): number {
  return budget.executionLimits === 'unbounded' ? Infinity : budget[key];
}
