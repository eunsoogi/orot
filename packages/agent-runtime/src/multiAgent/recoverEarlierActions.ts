import type { MultiAgentCheckpointState, MultiAgentWorkflowOptions } from './contracts';
import { recoverCommittedAction } from './recoverCommittedAction';

/** Before issuing a one-use pending-action capability, validate every earlier
 * completed action with its own fresh approval and protected input. The local copy
 * removes only the later pending intent for this read-only verifier, never in DB.
 */
export async function recoverEarlierActions<T>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<T>,
  signal: AbortSignal,
): Promise<boolean> {
  if (!state.committedAction) return state.committedActionReceipts === undefined;
  const receipts = state.committedActionReceipts;
  if (
    !Array.isArray(receipts) ||
    !receipts.length ||
    receipts.some(
      (r) =>
        !/^tool-[1-9]\d*$/.test(r?.operationKey ?? '') ||
        !Number.isSafeInteger(Number(r.operationKey.slice(5))) ||
        Number(r.operationKey.slice(5)) >= state.toolCalls,
    )
  )
    return false;
  return recoverCommittedAction({ ...state, pendingOperation: undefined }, options, signal);
}
