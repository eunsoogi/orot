import { canceled, completeState, operationKey, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { canReserveToolModelCall } from './evidenceToolModelBudget';

/** Persist the full declared cost before entering the read-only adapter. A crash
 * during its delegated request stays an uncertain pending tool operation and cannot replay. */
export function prepareEvidenceSearch<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
) {
  if (context.signal.aborted) {
    canceled(context);
    return completeState();
  }
  const tool = context.options.tools.find((candidate) => candidate.id === state.selectedToolId);
  if (
    !tool ||
    !context.researchInput ||
    state.toolCalls >= state.budget.maxToolCalls ||
    state.evidenceReferences.length >= state.budget.maxEvidenceItems ||
    !canReserveToolModelCall(tool, state)
  ) {
    stop(context, 'The read-only evidence search could not be started.', 'budget_exceeded');
    return completeState();
  }
  return {
    phase: 'evidence_search' as const,
    modelCalls: state.modelCalls + (tool.additionalModelCalls ?? 0),
    toolCalls: state.toolCalls + 1,
    pendingOperation: {
      kind: 'tool' as const,
      operationKey: operationKey('tool', state.toolCalls + 1),
    },
  };
}
