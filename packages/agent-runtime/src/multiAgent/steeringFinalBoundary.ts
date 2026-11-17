import { executionLimit } from './executionLimits';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

/** Drain late instructions at a settled answer boundary, never by cancelling or replaying a call. */
export async function steeringFinalBoundary<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  result: Partial<WorkflowState>,
): Promise<Partial<WorkflowState>> {
  const calls = Math.max(state.modelCalls, result.modelCalls ?? 0);
  const steering = context.options.operationJournal?.steering;
  if (
    !steering ||
    context.signal.aborted ||
    context.outcome?.status !== 'result' ||
    result.phase !== 'complete' ||
    calls >= executionLimit(state.budget, 'maxModelCalls') ||
    state.committedAction ||
    state.committedActionReceipts?.length
  )
    return result;
  // A completed mutation is not automatically replayed to satisfy a late instruction.
  // Existing graph budgets, fresh consent, evidence fences and journal identities still apply.
  let queued = false;
  try {
    queued = (await steering.list()).some((row) => row.status === 'queued');
  } catch {
    return result;
  }
  if (!queued || context.signal.aborted) return result;
  context.outcome = undefined;
  return {
    ...result,
    phase: 'revised_response',
    terminal: false,
    pendingOperation: undefined,
    modelCalls: calls,
  };
}
