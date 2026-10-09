import type { JsonValue } from '@orot/model-runtime';
import type {
  MultiAgentCheckpointState,
  MultiAgentInvocation,
  MultiAgentRunResult,
  MultiAgentWorkflowOptions,
} from './contracts';
import { referencesFromBatch, validateEvidenceBatch } from './evidence';
import { observeUntilAbort } from './modelCall';
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

// Coordinates graph actions and revalidates references before a durable restart resumes.
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
  if (options.checkpointer && invocation.config?.configurable?.checkpoint_id != null) {
    // An explicit ID can select an older safe snapshot while newer work remains pending.
    return {
      status: 'stale_evidence',
      reason: 'A specific checkpoint cannot be selected for a persisted run.',
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
      // Checkpoints contain references only, so reload content from current local sources first.
      const saved = await graph.getState(invocation.config!);
      const savedValues = saved.values;
      const hasSavedGraphState =
        savedValues !== undefined &&
        (savedValues === null ||
          typeof savedValues !== 'object' ||
          Array.isArray(savedValues) ||
          Object.keys(savedValues).length > 0);
      if (hasSavedGraphState) {
        if (invocation.resumeFrom) {
          stop(
            context,
            'A checkpoint already exists for this thread; use a fresh thread identifier.',
            'stale_evidence',
          );
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
        if (!savedValues || typeof savedValues !== 'object' || Array.isArray(savedValues)) {
          stop(
            context,
            'The saved run cannot be safely resumed; start a fresh run.',
            'stale_evidence',
          );
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
        const savedState = resumeState(savedValues as MultiAgentCheckpointState, options);
        if (!savedState) {
          stop(
            context,
            'The saved run cannot be safely resumed; start a fresh run.',
            'stale_evidence',
          );
          return failureResult(context.outcome!, nonResumableCheckpoint(start));
        }
        const restored = await restoreRunEvidence(options, savedState, controller.signal);
        if (!restored) {
          if (controller.signal.aborted) canceled(context);
          else
            stop(
              context,
              'Saved evidence could not be restored at the same source revisions.',
              'stale_evidence',
            );
          return failureResult(context.outcome!, nonResumableCheckpoint(savedState));
        }
        start = savedState;
        context.currentEvidence = restored;
        persistedGraphResume = true;
      }
    }
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
      // Null resumes the validated graph boundary; sync durability fences later side effects.
      const finalState = await graph.invoke(persistedGraphResume ? null : start, {
        ...invocation.config,
        durability: 'sync',
      });
      if (!context.outcome)
        stop(context, 'The workflow ended without a validated result.', 'invalid_output');
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
