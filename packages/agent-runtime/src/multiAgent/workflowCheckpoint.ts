import type {
  MultiAgentCheckpointState,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
  MultiAgentRunResult,
} from './contracts';
import { observeUntilAbort } from './modelCall';
import { deferEvidenceAdapter, revalidateCurrentEvidence } from './modelCallFreshness';
import { canceled, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import { checkpointFromState, nonResumableCheckpoint } from './state';
import type { WorkflowState } from './state';
import { failureResult, publicResult, restoreRunEvidence, resumeState } from './workflowSupport';

export type PersistedGraphResume<TResult> =
  | { status: 'fresh' }
  | { status: 'cancelled' }
  | { status: 'stale'; reason: string; state: WorkflowState }
  | {
      status: 'resumed';
      state: WorkflowState;
      evidence: MultiAgentWorkflowOptions<TResult>['initialEvidence'];
    };

const checkpointThreadTails = new Map<string, Promise<void>>();

export type CheckpointThreadLockResult<TResult> =
  { status: 'completed'; value: TResult } | { status: 'aborted' };

/** Serializes graph runs by thread so concurrent callers cannot dispatch the same saved operation. */
export async function withCheckpointThreadLock<TResult>(
  threadId: string,
  signal: AbortSignal,
  operation: () => Promise<TResult>,
): Promise<CheckpointThreadLockResult<TResult>> {
  const previous = checkpointThreadTails.get(threadId);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  checkpointThreadTails.set(threadId, current);
  let released = false;
  const releaseCurrent = () => {
    if (released) return;
    released = true;
    release();
    if (checkpointThreadTails.get(threadId) === current) checkpointThreadTails.delete(threadId);
  };

  if (previous && !(await waitForCheckpointThreadTurn(previous, signal))) {
    // Keep this queue slot until its predecessor finishes, even though its caller has returned.
    previous.then(releaseCurrent, releaseCurrent);
    return { status: 'aborted' };
  }
  if (signal.aborted) {
    if (previous) previous.then(releaseCurrent, releaseCurrent);
    else releaseCurrent();
    return { status: 'aborted' };
  }

  try {
    return { status: 'completed', value: await operation() };
  } finally {
    releaseCurrent();
  }
}

async function waitForCheckpointThreadTurn(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (canProceed: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(canProceed && !signal.aborted);
    };
    const onAbort = () => finish(false);
    signal.addEventListener('abort', onAbort, { once: true });
    previous.then(
      () => finish(true),
      () => finish(true),
    );
    if (signal.aborted) finish(false);
  });
}

/** Refuses caller-supplied selectors that could make inspection and invocation read different snapshots. */
export function hasExplicitCheckpointSelector(config: MultiAgentInvocation['config']): boolean {
  const configurable = config?.configurable as Record<string, unknown> | undefined;
  return configurable?.checkpoint_id != null || configurable?.checkpoint_map != null;
}

/** Defers evidence adapters so cancellation can stop local storage or network access before dispatch. */
export function withDeferredEvidenceAdapters<TResult>(
  options: MultiAgentWorkflowOptions<TResult>,
): MultiAgentWorkflowOptions<TResult> {
  return {
    ...options,
    revalidateEvidence: (references, signal) =>
      deferEvidenceAdapter(signal, () => options.revalidateEvidence(references, signal)),
    restoreEvidence: options.restoreEvidence
      ? (references, signal) =>
          deferEvidenceAdapter(signal, () => options.restoreEvidence!(references, signal))
      : undefined,
  };
}

/** Reopens a saved graph only after safe checkpoint shape and current source revisions agree. */
export async function loadPersistedGraphResume<TResult>(
  options: MultiAgentWorkflowOptions<TResult>,
  readSnapshot: () => Promise<{ values: unknown }>,
  state: WorkflowState,
  signal: AbortSignal,
  hasManualResume: boolean,
): Promise<PersistedGraphResume<TResult>> {
  if (signal.aborted) return { status: 'cancelled' };
  const read = await observeUntilAbort(deferEvidenceAdapter(signal, readSnapshot), signal);
  if (read.kind === 'cancelled' || signal.aborted) return { status: 'cancelled' };
  if (read.kind === 'error') throw new Error('Checkpoint state could not be read.');

  const values = read.value.values;
  const hasSavedState =
    values !== undefined &&
    (values === null ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.keys(values).length > 0);
  if (!hasSavedState) return { status: 'fresh' };
  if (hasManualResume) {
    return {
      status: 'stale',
      reason: 'A checkpoint already exists for this thread; use a fresh thread identifier.',
      state,
    };
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return {
      status: 'stale',
      reason: 'The saved run cannot be safely resumed; start a fresh run.',
      state,
    };
  }

  const savedState = resumeState(values as MultiAgentCheckpointState, options);
  if (!savedState) {
    return {
      status: 'stale',
      reason: 'The saved run cannot be safely resumed; start a fresh run.',
      state,
    };
  }
  const restored = await restoreRunEvidence(
    withDeferredEvidenceAdapters(options),
    savedState,
    signal,
  );
  if (!restored) {
    if (signal.aborted) return { status: 'cancelled' };
    return {
      status: 'stale',
      reason: 'Saved evidence could not be restored at the same source revisions.',
      state: savedState,
    };
  }
  return { status: 'resumed', state: savedState, evidence: restored };
}

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

/** Completes a durable graph call and rechecks published evidence after its final checkpoint. */
export async function invokeWorkflowGraph<TResult>(
  invoke: (input: WorkflowState | null) => Promise<WorkflowState>,
  input: WorkflowState | null,
  failureState: WorkflowState,
  context: RuntimeContext<TResult>,
): Promise<MultiAgentRunResult<TResult>> {
  if (context.signal.aborted) {
    canceled(context);
    return failureResult(context.outcome!, nonResumableCheckpoint(failureState));
  }
  const operation = invoke(input);
  const result = await observeUntilAbort(operation, context.signal);
  if (result.kind === 'cancelled') {
    await preservePendingCancellation(operation, context);
    return failureResult(context.outcome!, nonResumableCheckpoint(failureState));
  }
  if (result.kind === 'error') throw new Error('The workflow invocation failed.');
  if (context.signal.aborted) {
    canceled(context, 'underlying_call_unconfirmed');
    return failureResult(context.outcome!, nonResumableCheckpoint(failureState));
  }

  const finalState = result.value;
  if (!context.outcome)
    stop(context, 'The workflow ended without a validated result.', 'invalid_output');
  const finalOutcome = context.outcome!;
  if (
    finalOutcome.status === 'result' ||
    (finalOutcome.status === 'needs_clarification' && typeof finalOutcome.message === 'string')
  ) {
    await revalidateCurrentEvidence(context, 'underlying_call_unconfirmed');
    if (
      context.signal.aborted &&
      (context.outcome?.status === 'result' || context.outcome?.status === 'needs_clarification')
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
