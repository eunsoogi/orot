import type { JsonObject } from '@orot/model-runtime';
import type { MultiAgentWorkflowOptions } from './contracts';
import {
  bindOwnedLiveConversationTools,
  type LiveDelegation,
  type LiveToolBatch,
  type LiveToolCall,
} from './ownedLiveConversationTools';
import { nativeToolMessagesForRequest } from './nativeTools';
import { makeGraph } from './workflowGraph';
import { initialState, validBudget, validIdentity } from './workflowSupport';
import { createWorkflowRunControl } from './workflowRunControl';
import { observeUntilAbort } from './operationObservation';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

export interface OwnedLiveGraphToolOptions<TResult> {
  readonly workflow: MultiAgentWorkflowOptions<TResult>;
  readonly owner: LiveDelegation;
  readonly signal: AbortSignal;
  /** Deltas and model tool arguments cannot stand in for a finalized user request. */
  readonly utterance:
    | { readonly kind: 'context-free'; current(): boolean }
    | { readonly kind: 'app-finalized'; readonly request: string; current(): boolean };
  readonly current: () => boolean;
  readonly nativeChallengeCurrent: (call: LiveToolCall) => boolean;
  readonly select: (
    declarations: readonly {
      readonly name: string;
      readonly description?: string;
      readonly parameters: JsonObject;
    }[],
    signal: AbortSignal,
  ) => Promise<LiveToolBatch | undefined>;
}

/** One selected Live tool runs through the stock Conversation graph, then
 * returns a local handoff. This function never sends a provider result. */
export async function runOwnedLiveGraphTool<TResult>(input: OwnedLiveGraphToolOptions<TResult>) {
  const { workflow, utterance } = input;
  const exactUtterance = () =>
    utterance.current() === true &&
    (utterance.kind === 'context-free'
      ? !workflow.actions?.length
      : Boolean(utterance.request.trim()) && utterance.request === workflow.request);
  if (
    input.signal.aborted ||
    !input.current() ||
    !exactUtterance() ||
    !validIdentity(workflow, utterance.kind === 'context-free') ||
    !validBudget(workflow) ||
    !workflow.provider.capabilities.toolCalling ||
    workflow.task.nativeToolResultMode !== 'evidence_references' ||
    workflow.checkpointer ||
    workflow.operationJournal ||
    workflow.initialSearch ||
    workflow.initialEvidence.items.length ||
    workflow.initialEvidence.coverage.length ||
    workflow.initialEvidence.conflicts.length ||
    workflow.tools.some((tool) => tool.execution !== 'local_read_only' || tool.additionalModelCalls)
  )
    return;
  const control = createWorkflowRunControl(input.signal, workflow.execution.budget.timeoutMs);
  let selected: LiveToolCall | undefined;
  const current = () =>
    !control.signal.aborted &&
    input.current() &&
    exactUtterance() &&
    (!selected || input.nativeChallengeCurrent(selected) === true);
  const fence = () => {
    if (!current()) throw new Error('The owned Live operation retired.');
    return Promise.resolve();
  };
  const context: RuntimeContext<TResult> = {
    options: {
      ...workflow,
      // A terminal local action must keep its domain's own proof before dispatch.
      beforeLocalAction: async (state, signal) => {
        await fence();
        await workflow.beforeLocalAction?.(state, signal);
        await fence();
      },
    },
    signal: control.signal,
    timedOut: control.timedOut,
    currentEvidence: workflow.initialEvidence,
    beforeTaskInputChange: fence,
  };
  // Live selection represents the responder's one already active model slot.
  const state = { ...initialState(context.options), modelCalls: 1 };
  let currentState: WorkflowState | undefined = state;
  const bound = bindOwnedLiveConversationTools({
    context,
    state,
    owner: input.owner,
    currentState: () => currentState,
    sharedGrantCurrent: current,
    nativeChallengeCurrent: input.nativeChallengeCurrent,
  });
  try {
    const declarations = bound?.advertise();
    if (!bound || !declarations) return;
    const offered = await observeUntilAbort(
      input.select(declarations, control.signal),
      control.signal,
    );
    if (offered.kind !== 'value' || !offered.value || !current()) return;
    const batch = offered.value;
    const admitted = await bound.accept(batch);
    if (admitted.status !== 'selected') return;
    selected = Object.freeze({ ...batch.calls[0]! });
    if (!current()) return;
    currentState = undefined;
    await makeGraph(context, { endAfterOwnedTool: true }).invoke({
      ...state,
      ...admitted.handoff,
    });
    if (!current()) return;
    if (admitted.handoff.phase === 'local_action')
      return context.outcome?.status === 'result'
        ? { status: 'local_action' as const, call: selected }
        : undefined;
    const message = nativeToolMessagesForRequest(context.nativeToolMessages).find(
      (item) => item.role === 'tool' && item.toolCallId === selected?.toolCallId,
    );
    if (context.outcome || message?.role !== 'tool') return;
    return {
      status: 'evidence_references' as const,
      call: selected,
      result: message.result,
    };
  } finally {
    bound?.retire();
    control.dispose();
  }
}
