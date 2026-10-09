import type { JsonValue } from '@orot/model-runtime';
import type {
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
  MultiAgentInvocation,
} from './contracts';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './modelCall';
import { deferEvidenceAdapter, revalidateCurrentEvidence } from './modelCallFreshness';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import { checkpointFromState, nonResumableCheckpoint } from './state';
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

async function preservePendingCancellation<TResult>(
  operation: Promise<unknown>,
  context: RuntimeContext<TResult>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    operation.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 0);
    }),
  ]);
  if (timer) clearTimeout(timer);
  canceled(context, 'underlying_call_unconfirmed');
}

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
  if (options.checkpointer && !invocation.config?.configurable?.thread_id) {
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
      checkpoint: nonResumableCheckpoint(initialState(options)),
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
      // The restore helper invokes these callbacks before it can inspect cancellation.
      const restoreOptions: MultiAgentWorkflowOptions<TResult> = {
        ...options,
        revalidateEvidence: (references, signal) =>
          deferEvidenceAdapter(signal, () => options.revalidateEvidence(references, signal)),
        restoreEvidence: options.restoreEvidence
          ? (references, signal) =>
              deferEvidenceAdapter(signal, () => options.restoreEvidence!(references, signal))
          : undefined,
      };
      const restored = await restoreRunEvidence(restoreOptions, start, controller.signal);
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
      const graph = makeGraph(context, options.checkpointer);
      if (options.checkpointer) {
        const read = await observeUntilAbort(graph.getState(invocation.config!), controller.signal);
        if (read.kind === 'cancelled') {
          canceled(context);
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
        if (read.kind === 'error') throw new Error('Checkpoint state could not be read.');
        if (controller.signal.aborted) {
          canceled(context);
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
        const saved = read.value;
        if (
          saved.values &&
          typeof saved.values === 'object' &&
          Object.keys(saved.values).length > 0
        ) {
          stop(
            context,
            'A checkpoint already exists for this thread; use a fresh thread identifier.',
            'stale_evidence',
          );
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
      }
      if (controller.signal.aborted) {
        canceled(context);
        return failureResult(context.outcome!, nonResumableCheckpoint(start));
      }
      // Each persisted thread is one-use; sync durability records pending work before dispatch.
      const graphRun = graph.invoke(start, { ...invocation.config, durability: 'sync' });
      const invocationResult = await observeUntilAbort(graphRun, controller.signal);
      if (invocationResult.kind === 'cancelled') {
        await preservePendingCancellation(graphRun, context);
        return failureResult(context.outcome!, nonResumableCheckpoint(start));
      }
      if (invocationResult.kind === 'error') throw new Error('The workflow invocation failed.');
      if (controller.signal.aborted) {
        canceled(context, 'underlying_call_unconfirmed');
        return failureResult(context.outcome!, nonResumableCheckpoint(start));
      }
      const finalState = invocationResult.value;
      if (!context.outcome)
        stop(context, 'The workflow ended without a validated result.', 'invalid_output');
      const finalOutcome = context.outcome!;
      if (
        finalOutcome.status === 'result' ||
        (finalOutcome.status === 'needs_clarification' && typeof finalOutcome.message === 'string')
      ) {
        // Recheck citations and task-approved clarification copy after the async final checkpoint.
        await revalidateCurrentEvidence(context, 'underlying_call_unconfirmed');
        if (
          controller.signal.aborted &&
          (context.outcome?.status === 'result' ||
            context.outcome?.status === 'needs_clarification')
        ) {
          canceled(context, 'underlying_call_unconfirmed');
        }
        const verifiedOutcome = context.outcome!;
        if (verifiedOutcome.status !== finalOutcome.status)
          return failureResult(verifiedOutcome, nonResumableCheckpoint(finalState));
      }
      return publicResult(
        context.outcome!,
        context.currentEvidence.coverage,
        checkpointFromState(finalState),
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
