import type { JsonValue } from '@orot/model-runtime';
import type {
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
  MultiAgentInvocation,
} from './contracts';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './modelCall';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import { checkpointFromState } from './state';
import {
  failureResult,
  initialState,
  makeGraph,
  publicResult,
  restoreRunEvidence,
  resumeState,
  validBudget,
  validIdentity,
} from './workflowSupport';

// Coordinates two model roles around allowlisted reads while persisting metadata only.
export async function runMultiAgentWorkflow<TResult = JsonValue>(
  options: MultiAgentWorkflowOptions<TResult>,
  invocation: MultiAgentInvocation = {},
): Promise<MultiAgentRunResult<TResult>> {
  if (!validIdentity(options) || !validBudget(options)) {
    return {
      status: 'invalid_output',
      reason: 'The run configuration was invalid.',
      checkpoint: checkpointFromState(initialState(options)),
    };
  }
  if (
    options.checkpointer &&
    !invocation.resumeFrom &&
    !invocation.config?.configurable?.thread_id
  ) {
    return {
      status: 'invalid_output',
      reason: 'A checkpoint thread identifier is required.',
      checkpoint: checkpointFromState(initialState(options)),
    };
  }
  const resumed = invocation.resumeFrom ? resumeState(invocation.resumeFrom, options) : undefined;
  if (invocation.resumeFrom && !resumed) {
    return {
      status: 'stale_evidence',
      reason: 'The saved run cannot be safely resumed; start a fresh run.',
      checkpoint: invocation.resumeFrom,
    };
  }
  const start = resumed ?? initialState(options);
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
    if (invocation.resumeFrom) {
      const restored = await restoreRunEvidence(options, start, controller.signal);
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
    } else {
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
          options.revalidateEvidence(references, controller.signal),
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
      const graph = makeGraph(context, invocation.resumeFrom ? undefined : options.checkpointer);
      if (options.checkpointer && !invocation.resumeFrom) {
        const saved = await graph.getState(invocation.config!);
        if (
          saved.values &&
          typeof saved.values === 'object' &&
          typeof saved.values.operationRunId === 'string'
        ) {
          stop(
            context,
            'A checkpoint already exists for this operation; use a fresh run identifier.',
            'stale_evidence',
          );
          return failureResult(context.outcome!, checkpointFromState(start));
        }
      }
      const finalState = await graph.invoke(start, invocation.config);
      if (!context.outcome)
        stop(context, 'The workflow ended without a validated result.', 'invalid_output');
      return publicResult(
        context.outcome!,
        context.currentEvidence.coverage,
        checkpointFromState(finalState),
      );
    }
    return failureResult(context.outcome!, checkpointFromState(start));
  } catch {
    if (controller.signal.aborted) canceled(context, 'underlying_call_unconfirmed');
    else stop(context, 'The workflow could not complete safely.', 'unavailable');
    return failureResult(context.outcome!, checkpointFromState(start));
  } finally {
    clearTimeout(timer);
    invocation.signal?.removeEventListener('abort', abortFromCaller);
  }
}
