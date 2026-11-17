import { executionLimit } from './executionLimits';
import type { MultiAgentCheckpointState, MultiAgentWorkflowOptions } from './contracts';
import { canonicalJson, utf8ByteLength } from './protocol';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';

/** A domain commit can precede the graph's result checkpoint. This verifier reads
 * that exact receipt after new consent; it never executes, rewrites a checkpoint,
 * clears a pending intent, or grants a cold claim on its own.
 */
export async function recoverPendingAction<TResult>(
  state: MultiAgentCheckpointState,
  options: MultiAgentWorkflowOptions<TResult>,
  signal: AbortSignal,
) {
  const pending = state.pendingOperation;
  const action = options.actions?.find((item) => item.id === state.selectedToolId);
  if (
    signal.aborted ||
    state.terminal ||
    state.phase !== 'local_action' ||
    state.awaitingAuthorization ||
    pending?.kind !== 'tool' ||
    !Number.isSafeInteger(state.toolCalls) ||
    state.toolCalls < 1 ||
    pending.operationKey !== `tool-${state.toolCalls}` ||
    !action?.recoverResult ||
    state.operationRunId !== options.execution.operationRunId
  )
    return undefined;
  const saved = await options.operationJournal?.loadPrepared?.(`${pending.operationKey}:context`);
  if (
    !saved ||
    saved.operationId !== `${pending.operationKey}:context` ||
    signal.aborted ||
    utf8ByteLength(saved.input) > executionLimit(state.budget, 'maxPayloadBytes')
  )
    return undefined;
  try {
    const original = JSON.parse(saved.input);
    const expected = {
      execution: options.execution,
      initialSearch: options.initialSearch,
      phase: state.phase,
      initialSearchStatus: state.initialSearchStatus,
      modelCalls: state.modelCalls,
      toolCalls: state.toolCalls,
      researchCycles: state.researchCycles,
      selectedToolId: state.selectedToolId,
      evidenceNeed: state.evidenceNeed,
      evidenceReferences: state.evidenceReferences,
    };
    if (
      canonicalJson(original.binding) !== canonicalJson(JSON.parse(JSON.stringify(expected))) ||
      canonicalJson(saved.evidenceReferences) !== canonicalJson(state.evidenceReferences)
    )
      return undefined;
    const input = action.parseInput(original.researchInput);
    if (
      !input ||
      canonicalJson(input) !== canonicalJson(original.researchInput) ||
      signal.aborted ||
      !(await action.authorize(input, signal)) ||
      signal.aborted
    )
      return undefined;
    const batch = await action.recoverResult({
      input,
      signal,
      operationRunId: state.operationRunId,
      operationKey: pending.operationKey,
    });
    if (
      !batch ||
      signal.aborted ||
      !batch.items.length ||
      batch.items.some((item) => item.sourceKind !== 'personal_record') ||
      validateEvidenceBatch(batch, options.execution.allowedScope, state.budget) ||
      utf8ByteLength(canonicalJson(batch)) > executionLimit(state.budget, 'maxPayloadBytes') ||
      !(await options.revalidateEvidence(referencesFromBatch(batch), signal)) ||
      signal.aborted
    )
      return undefined;
    return batch;
  } catch {
    return undefined;
  }
}
