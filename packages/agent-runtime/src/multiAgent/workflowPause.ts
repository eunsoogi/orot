import { isGraphDrained, RunControl, type Runtime } from '@langchain/langgraph/web';
import type { MultiAgentCheckpointState, MultiAgentWorkflowOptions } from './contracts';
import type { RuntimeContext } from './runtimeContext';
import { checkpointFromState, type WorkflowState } from './state';
import { preparePrivateOperationContext } from './workflowPrivateContext';
import { completeState, stop } from './runtimeContext';
import { isAuthorizationPaused } from './journaledModelCall';
import { resumeState } from './workflowSupport';

/** One controller per attempt. A request drains only after a verified safe node boundary. */
export class MultiAgentPauseController {
  readonly control = new RunControl();
  private requested = false;
  private approvalWaits = new Set<AbortController>();

  requestPause(): void {
    this.requested = true;
    for (const waiting of this.approvalWaits) waiting.abort();
  }

  /** Only approval waits are interruptible; an already-dispatched operation is never aborted here. */
  approvalSignal(parent: AbortSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    parent.addEventListener('abort', onAbort, { once: true });
    this.approvalWaits.add(controller);
    if (parent.aborted || this.requested) controller.abort();
    return {
      signal: controller.signal,
      finishApproval: () => this.approvalWaits.delete(controller),
      dispose: () => {
        this.approvalWaits.delete(controller);
        parent.removeEventListener('abort', onAbort);
      },
    };
  }

  /** Never clear an uncertain pending operation just to make a checkpoint resumable. */
  boundary<TResult>(state: WorkflowState, context: RuntimeContext<TResult>): void {
    if (this.requested && context.options.checkpointer && resumeState(state, context.options)) {
      this.control.requestDrain('background-pause');
    }
  }
}

export function createMultiAgentPauseController(): MultiAgentPauseController {
  return new MultiAgentPauseController();
}

export interface MultiAgentPausedResult {
  readonly status: 'paused';
  readonly checkpoint: MultiAgentCheckpointState;
}

/** The node has finished before the graph is allowed to drain and save its next task. */
export function pauseBoundaryWrapper<TResult>(context: RuntimeContext<TResult>) {
  return (
      node: (
        state: WorkflowState,
        runtime: Runtime,
      ) => Partial<WorkflowState> | Promise<Partial<WorkflowState>>,
    ) =>
    async (state: WorkflowState, runtime: Runtime): Promise<Partial<WorkflowState>> => {
      const pending =
        state.pendingOperation ??
        (state.awaitingAuthorization
          ? {
              kind: state.phase === 'evidence_search' ? ('tool' as const) : ('model' as const),
              operationKey: state.awaitingAuthorization,
            }
          : undefined);
      if (
        pending &&
        !(await preparePrivateOperationContext(context, state, pending.operationKey))
      ) {
        stop(context, 'Prepared operation context is no longer current.', 'stale_evidence');
        return completeState();
      }
      context.activeModelOperation =
        pending?.kind === 'model'
          ? { operationKey: pending.operationKey, callIndex: 0 }
          : undefined;
      let update: Partial<WorkflowState>;
      try {
        update = {
          awaitingAuthorization: undefined,
          ...(await node({ ...state, pendingOperation: pending }, runtime)),
        };
      } catch (error) {
        if (!isAuthorizationPaused(error) || context.signal.aborted || pending?.kind !== 'model')
          throw error;
        // The journal proved all previous calls completed and the current call has no dispatch intent.
        context.outcome = undefined;
        update = { pendingOperation: undefined, awaitingAuthorization: pending.operationKey };
      } finally {
        context.activeModelOperation = undefined;
      }
      context.pause?.boundary({ ...state, ...update }, context);
      return update;
    };
}

/** A drain is not cancellation. Read the durable latest state; invalid snapshots still fail closed. */
export async function invokeWithPause<TResult>(
  invoke: () => Promise<WorkflowState>,
  read: () => Promise<{ values: unknown }>,
  context: RuntimeContext<TResult>,
): Promise<WorkflowState> {
  try {
    return await invoke();
  } catch (error) {
    if (!isGraphDrained(error) || !context.pause || context.signal.aborted) throw error;
    const snapshot = await read();
    const state = resumeState(snapshot.values as MultiAgentCheckpointState, context.options);
    if (!state || context.signal.aborted) throw error;
    context.pausedCheckpoint = checkpointFromState(state);
    return state;
  }
}

/** Structural/run-identity gate only. Resume still revalidates and restores source revisions. */
export function isMultiAgentCheckpointResumable<TResult>(
  value: unknown,
  options: MultiAgentWorkflowOptions<TResult>,
): value is MultiAgentCheckpointState {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    resumeState(value as MultiAgentCheckpointState, options),
  );
}
