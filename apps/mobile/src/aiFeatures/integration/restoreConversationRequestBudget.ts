import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import { continuationInput } from '../../storage/conversationWorkflowContinuationIdentity';

/** Older protected invocations predate the optional aggregate request limit.
 * Only select that exact historical shape, never relax the final identity check
 * or restore arbitrary limits from persisted/untrusted text. */
export function restoreConversationRequestBudget<T>(
  options: MultiAgentWorkflowOptions<T>,
  exactInput: string,
): MultiAgentWorkflowOptions<T> {
  if (!['9', '10', '11'].includes(options.task.taskVersion)) return options;
  if (continuationInput(options) === exactInput) return options;
  const budget = { ...options.execution.budget };
  delete budget.maxModelRequestBytes;
  const historical = {
    ...options,
    execution: { ...options.execution, budget },
  };
  return continuationInput(historical) === exactInput ? historical : options;
}
