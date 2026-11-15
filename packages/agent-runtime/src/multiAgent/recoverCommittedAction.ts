import type { MultiAgentWorkflowOptions, MultiAgentCheckpointState } from './contracts';
import { committedActionReceiptMatches } from './committedActionReceipt';
import { canonicalJson } from './protocol';
import { sameReference } from './evidence';

/** Verify a completed domain receipt against protected original input; never execute a mutation.
 * A missing or uncertain result is not permission to retry. Caller still owns source/claim fences.
 */
export async function recoverCommittedAction<TResult>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<TResult>,
  signal: AbortSignal,
): Promise<boolean> {
  const receipts = state.committedActionReceipts;
  if (!state.committedAction) return receipts === undefined;
  if (
    !Array.isArray(receipts) ||
    !receipts.length ||
    receipts.some((r) => !r || typeof r !== 'object') ||
    receipts.length > state.toolCalls ||
    new Set(receipts.map((r) => r.operationKey)).size !== receipts.length
  )
    return false;
  for (const receipt of receipts) {
    if (!(await recoverOne(state, options, signal, receipt))) return false;
  }
  return !signal.aborted;
}

async function recoverOne<TResult>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<TResult>,
  signal: AbortSignal,
  receipt: import('./committedActionReceipt').CommittedActionReceipt,
): Promise<boolean> {
  const action = options.actions?.find((item) => item.id === receipt?.toolId);
  if (
    !receipt ||
    !action?.recover ||
    signal.aborted ||
    state.pendingOperation ||
    options.execution.operationRunId !== state.operationRunId ||
    !committedActionReceiptMatches(receipt, {
      operationRunId: state.operationRunId,
      operationKey: receipt.operationKey,
      toolId: action.id,
      toolVersion: action.version,
      evidenceReferences: receipt.evidenceReferences,
    }) ||
    !receipt.evidenceReferences.every((ref) =>
      state.evidenceReferences.some((current) => sameReference(ref, current)),
    )
  )
    return false;
  const saved = await options.operationJournal?.loadPrepared?.(`${receipt.operationKey}:context`);
  if (!saved || saved.operationId !== `${receipt.operationKey}:context` || signal.aborted)
    return false;
  try {
    const original = JSON.parse(saved.input);
    // The protected context was recorded immediately before the original action dispatch.
    if (
      canonicalJson(original.binding.execution) !== canonicalJson(options.execution) ||
      original.binding.phase !== 'local_action' ||
      original.binding.selectedToolId !== action.id ||
      `tool-${original.binding.toolCalls}` !== receipt.operationKey ||
      canonicalJson(original.binding.evidenceReferences) !== canonicalJson(saved.evidenceReferences)
    )
      return false;
    const input = action.parseInput(original.researchInput);
    if (!input || signal.aborted || !(await action.authorize(input, signal)) || signal.aborted)
      return false;
    const actual = await action.recover({
      input,
      evidenceReferences: receipt.evidenceReferences,
      operationRunId: receipt.operationRunId,
      operationKey: receipt.operationKey,
      signal,
    });
    if (!actual || signal.aborted) return false;
    return (
      actual.length === receipt.evidenceReferences.length &&
      actual.every((ref) =>
        receipt.evidenceReferences.some((expected) => sameReference(ref, expected)),
      ) &&
      (await options.revalidateEvidence(actual, signal)) &&
      !signal.aborted
    );
  } catch {
    return false;
  }
}

/** Only an undispatched model-approval wait has a protected post-action conversation context. */
export function canRecoverCommittedActions<TResult>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<TResult>,
): boolean {
  if (!state.committedAction) return state.committedActionReceipts === undefined;
  const receipts = state.committedActionReceipts;
  return Boolean(
    state.phase === 'revised_response' &&
    state.awaitingAuthorization &&
    options.operationJournal?.loadPrepared &&
    Array.isArray(receipts) &&
    receipts.length &&
    receipts.every((r) => r && typeof r === 'object') &&
    receipts.length <= state.toolCalls &&
    new Set(receipts.map((r) => r.operationKey)).size === receipts.length &&
    receipts.every((receipt) => {
      const action = options.actions?.find((item) => item.id === receipt.toolId);
      return (
        action?.recover &&
        committedActionReceiptMatches(receipt, {
          operationRunId: state.operationRunId,
          operationKey: receipt.operationKey,
          toolId: action.id,
          toolVersion: action.version,
          evidenceReferences: receipt.evidenceReferences,
        }) &&
        receipt.evidenceReferences.every((ref) =>
          state.evidenceReferences.some((current) => sameReference(ref, current)),
        )
      );
    }),
  );
}
