import { recoverEarlierActions } from './recoverEarlierActions';
import { checkpointFromState, type WorkflowState } from './state';
import type { MultiAgentCheckpointState, MultiAgentWorkflowOptions } from './contracts';
import { canonicalJson } from './protocol';
import { referencesFromBatch } from './evidence';
import { recoverPendingAction } from './recoverPendingAction';

const verified = new WeakMap<object, string>();
const stateKey = (state: MultiAgentCheckpointState) =>
  canonicalJson(JSON.parse(JSON.stringify(checkpointFromState(state as WorkflowState))));

/** Capability is process-local and bound to the complete checked domain checkpoint.
 * Neither serialized input nor a caller-supplied boolean can bypass the pending gate.
 */
export function isVerifiedPendingActionRecovery(
  options: object,
  state: MultiAgentCheckpointState,
): boolean {
  return verified.get(options) === stateKey(state);
}

/** Internal evidence-only deferral preserves the same action/journal capability.
 * Any change outside these three cancellation wrappers invalidates inheritance. */
export function bindDeferredRecoveryEvidence<T>(
  original: MultiAgentWorkflowOptions<T>,
  next: MultiAgentWorkflowOptions<T>,
) {
  const wrappers = new Set(['revalidateEvidence', 'restoreEvidence', 'restoreEvidenceBatches']);
  if (
    Object.keys(next).every(
      (key) =>
        wrappers.has(key) ||
        next[key as keyof typeof next] === original[key as keyof typeof original],
    ) &&
    Object.keys(original).every((key) => key in next)
  ) {
    const key = verified.get(original);
    if (key) verified.set(next, key);
  }
  return next;
}

/** Replace only the interrupted invocation with a one-use read-only result port.
 * New approval and domain proof happen before this capability exists. Even if the
 * graph reruns its execute node, it cannot reach the original mutation adapter.
 */
export async function preparePendingActionRecovery<T>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<T>,
  signal: AbortSignal,
  retainResult?: (
    batch: import('./evidenceContracts').EvidenceBatch,
  ) => import('./evidenceContracts').EvidenceBatch,
): Promise<MultiAgentWorkflowOptions<T> | undefined> {
  if (!(await recoverEarlierActions(state, options, signal)) || signal.aborted) return undefined;
  const operationId = `${state.pendingOperation?.operationKey}:context`;
  const original = await options.operationJournal?.loadPrepared?.(operationId);
  if (!original || signal.aborted) return undefined;
  // Snapshot once: the input used below is exactly the input the verifier approved.
  const saved = JSON.parse(JSON.stringify(original));
  const batch = await recoverPendingAction(
    state,
    {
      ...options,
      operationJournal: {
        ...options.operationJournal!,
        loadPrepared: async (id) => (id === operationId ? saved : undefined),
      },
    },
    signal,
  );
  if (!batch || signal.aborted) return undefined;
  const input = JSON.parse(saved.input).researchInput;
  let consumed = false;
  const recovered = {
    ...options,
    actions: options.actions!.map((action) =>
      action.id !== state.selectedToolId
        ? action
        : {
            ...action,
            async authorize(value: Parameters<typeof action.authorize>[0], current: AbortSignal) {
              return (
                !consumed &&
                !signal.aborted &&
                !current.aborted &&
                canonicalJson(value) === canonicalJson(input)
              );
            },
            async execute(request: Parameters<typeof action.execute>[0]) {
              if (
                consumed ||
                signal.aborted ||
                request.signal.aborted ||
                request.operationRunId !== state.operationRunId ||
                request.operationKey !== state.pendingOperation!.operationKey ||
                canonicalJson(request.input) !== canonicalJson(input)
              )
                throw new Error('Verified action recovery is no longer current.');
              consumed = true;
              if (
                !(await options.revalidateEvidence(referencesFromBatch(batch), request.signal)) ||
                signal.aborted ||
                request.signal.aborted
              )
                throw new Error('Verified action result changed.');
              return retainResult ? retainResult(batch) : batch;
            },
          },
    ),
  };
  verified.set(recovered, stateKey(state));
  return recovered;
}
