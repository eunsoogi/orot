import type { JsonValue } from '@orot/model-runtime';
import type {
  MultiAgentInvocation,
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
} from './contracts';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './modelCall';
import { deferEvidenceAdapter } from './modelCallFreshness';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import { checkpointFromState, nonResumableCheckpoint } from './state';
import {
  failureResult,
  initialState,
  makeGraph,
  restoreRunEvidence,
  resumeState,
  validBudget,
  validIdentity,
} from './workflowSupport';
import {
  hasExplicitCheckpointSelector,
  invokeWorkflowGraph,
  loadPersistedGraphResume,
  withCheckpointThreadLock,
  withDeferredEvidenceAdapters,
} from './workflowCheckpoint';

// Coordinates validated graph runs and restores saved evidence only after source checks pass.
export function runMultiAgentWorkflow<TResult = JsonValue>(
  options: MultiAgentWorkflowOptions<TResult>,
  invocation: MultiAgentInvocation = {},
): Promise<MultiAgentRunResult<TResult>> {
  const threadId = invocation.config?.configurable?.thread_id;
  if (options.checkpointer && typeof threadId === 'string' && threadId.length > 0) {
    return withCheckpointThreadLock(threadId, () =>
      runMultiAgentWorkflowUnlocked(options, invocation),
    );
  }
  return runMultiAgentWorkflowUnlocked(options, invocation);
}

async function runMultiAgentWorkflowUnlocked<TResult = JsonValue>(
  options: MultiAgentWorkflowOptions<TResult>,
  invocation: MultiAgentInvocation,
): Promise<MultiAgentRunResult<TResult>> {
  if (!validIdentity(options) || !validBudget(options)) {
    return {
      status: 'invalid_output',
      reason: 'The run configuration was invalid.',
      checkpoint: checkpointFromState(initialState(options)),
    };
  }
  if (options.checkpointer && !invocation.config?.configurable?.thread_id) {
    return {
      status: 'invalid_output',
      reason: 'A checkpoint thread identifier is required.',
      checkpoint: checkpointFromState(initialState(options)),
    };
  }
  if (options.checkpointer && hasExplicitCheckpointSelector(invocation.config)) {
    // Caller selectors can make state validation and graph resume inspect different snapshots.
    return {
      status: 'stale_evidence',
      reason: 'A checkpoint selector cannot be used for a persisted run.',
      checkpoint: nonResumableCheckpoint(initialState(options)),
    };
  }

  const resumed = invocation.resumeFrom ? resumeState(invocation.resumeFrom, options) : undefined;
  if (invocation.resumeFrom && !resumed) {
    return {
      status: 'stale_evidence',
      reason: 'The saved run cannot be safely resumed; start a fresh run.',
      checkpoint: nonResumableCheckpoint(initialState(options)),
    };
  }
  let start = resumed ?? initialState(options);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (invocation.signal?.aborted) controller.abort();
  else invocation.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.execution.budget.timeoutMs);
  const context: RuntimeContext<TResult> = {
    options,
    signal: controller.signal,
    timedOut: () => timedOut,
    currentEvidence: options.initialEvidence,
  };
  try {
    const graph = makeGraph(context, options.checkpointer);
    let persistedGraphResume = false;
    if (options.checkpointer) {
      // Checkpoint channel values hold references only; restore source content after validation.
      const persisted = await loadPersistedGraphResume(
        options,
        () => graph.getState(invocation.config!),
        start,
        controller.signal,
        Boolean(invocation.resumeFrom),
      );
      if (persisted.status === 'cancelled') {
        canceled(context);
        return failureResult(context.outcome!, nonResumableCheckpoint(start));
      }
      if (persisted.status === 'stale') {
        stop(context, persisted.reason, 'stale_evidence');
        return failureResult(context.outcome!, nonResumableCheckpoint(persisted.state));
      }
      if (persisted.status === 'resumed') {
        start = persisted.state;
        context.currentEvidence = persisted.evidence;
        persistedGraphResume = true;
      }
    }

    if (invocation.resumeFrom) {
      const restored = await restoreRunEvidence(
        withDeferredEvidenceAdapters(options),
        start,
        controller.signal,
      );
      if (!restored) {
        if (controller.signal.aborted) canceled(context);
        else
          stop(
            context,
            'Saved evidence could not be restored at the same source revisions.',
            'stale_evidence',
          );
        return failureResult(context.outcome!, checkpointFromState(start));
      }
      context.currentEvidence = restored;
    } else if (!persistedGraphResume) {
      const invalid = validateEvidenceBatch(
        options.initialEvidence,
        options.execution.allowedScope,
        options.execution.budget,
      );
      if (invalid) {
        stop(context, invalid, 'invalid_output');
        return failureResult(context.outcome!, checkpointFromState(start));
      }
      const references = referencesFromBatch(options.initialEvidence);
      if (references.length > 0) {
        const freshness = await observeUntilAbort(
          deferEvidenceAdapter(controller.signal, () =>
            options.revalidateEvidence(references, controller.signal),
          ),
          controller.signal,
        );
        if (freshness.kind === 'cancelled') canceled(context);
        else if (freshness.kind === 'error' || !freshness.value) {
          stop(context, 'Initial evidence was no longer current at run start.', 'stale_evidence');
        }
        if (context.outcome) return failureResult(context.outcome, checkpointFromState(start));
      }
    }

    if (controller.signal.aborted) canceled(context);
    else {
      return await invokeWorkflowGraph(
        (input) =>
          graph.invoke(input, {
            ...invocation.config,
            durability: 'sync',
          }),
        persistedGraphResume ? null : start,
        start,
        context,
      );
    }
    return failureResult(context.outcome!, nonResumableCheckpoint(start));
  } catch {
    if (controller.signal.aborted) canceled(context, 'underlying_call_unconfirmed');
    else stop(context, 'The workflow could not complete safely.', 'unavailable');
    return failureResult(context.outcome!, nonResumableCheckpoint(start));
  } finally {
    clearTimeout(timer);
    invocation.signal?.removeEventListener('abort', abortFromCaller);
  }
}
