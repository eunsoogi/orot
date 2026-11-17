import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import { continuationInput } from '../../storage/conversationWorkflowContinuationIdentity';

/** Older protected invocations predate optional aggregate request/evidence limits.
 * Only select that exact historical shape, never relax the final identity check
 * or restore arbitrary limits from persisted/untrusted text. */
export function restoreConversationRequestBudget<T>(
  options: MultiAgentWorkflowOptions<T>,
  exactInput: string,
): MultiAgentWorkflowOptions<T> {
  if (continuationInput(options) === exactInput) return options;
  // Try only budgets this app shipped. Never copy a budget from persisted text.
  const withoutEvidenceOptOut = { ...options.execution.budget };
  delete withoutEvidenceOptOut.maxAccumulatedEvidenceItems;
  const candidates = [withoutEvidenceOptOut];
  if (['9', '10', '11'].includes(options.task.taskVersion)) {
    for (const budget of [options.execution.budget, withoutEvidenceOptOut]) {
      const historical = { ...budget };
      delete historical.maxModelRequestBytes;
      candidates.push(historical);
    }
  }
  for (const budget of candidates) {
    const historical = {
      ...options,
      execution: { ...options.execution, budget },
    };
    if (continuationInput(historical) === exactInput) return historical;
  }
  return options;
}
