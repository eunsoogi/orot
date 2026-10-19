import type { LanguageModelRequest } from '@orot/model-runtime';
import type { LanguageModelStreamEvent } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import type { ModelCallOutcome } from './modelCall';
import { callModelWithEvidenceFreshness } from './modelCallFreshness';
import { buildTaskRequest } from './requests';
import { consumeResponderResponse } from './responses';
import {
  canceled,
  completeState,
  operationKey,
  reportProgress,
  reportTaskStreamEvent,
  stop,
} from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { consumeNativeToolCall, withNativeTools } from './nativeTools';

type ResponderTextEvent = Extract<
  LanguageModelStreamEvent,
  { readonly type: 'text_delta' | 'text_snapshot' }
>;

/** Keeps raw structured tokens inside the runtime and emits only the task's current display projection. */
function createTaskTextObserver<TResult>(
  context: RuntimeContext<TResult>,
  input: TaskResponderInput,
): ((event: ResponderTextEvent) => void) | undefined {
  const project = context.options.task.projectStreamedText;
  if (!context.onTaskStreamEvent || !project) return undefined;
  let rawOutput = '';
  let displayed = '';
  return (event) => {
    rawOutput = event.type === 'text_delta' ? rawOutput + event.text : event.text;
    let projected: string | undefined;
    try {
      projected = project(rawOutput, input);
    } catch {
      projected = undefined;
    }
    const next = projected ?? '';
    if (next === displayed) return;
    const update = next.startsWith(displayed)
      ? { type: 'text_delta' as const, text: next.slice(displayed.length) }
      : { type: 'text_snapshot' as const, text: next };
    displayed = next;
    reportTaskStreamEvent(context, update);
  };
}

/** Applies task validation and, when explicitly requested, one bounded correction call. */
export async function consumeTaskModelResponse<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  request: LanguageModelRequest,
  input: TaskResponderInput,
  revised: boolean,
): Promise<Partial<WorkflowState>> {
  context.responseCorrectionInstruction = undefined;
  const onTaskText = createTaskTextObserver(context, input);
  if (onTaskText) {
    reportTaskStreamEvent(context, { type: 'started' });
  }
  const outcome = await callModelWithEvidenceFreshness(
    context,
    withNativeTools(context, state, request),
    onTaskText,
  );
  if (!outcome) return completeState();
  if (outcome.status !== 'response') return finishModelFailure(context, outcome);
  const toolCall = consumeNativeToolCall(context, state, outcome.response);
  if (toolCall) return toolCall;
  const result = consumeResponderResponse(context, state, outcome.response, input, revised);
  const correctionInstruction = context.responseCorrectionInstruction;
  context.responseCorrectionInstruction = undefined;
  if (!correctionInstruction) return result;
  if (context.signal.aborted) {
    canceled(context);
    return { ...completeState(), modelCalls: state.modelCalls };
  }
  if (state.modelCalls >= state.budget.maxModelCalls) {
    stop(context, 'The model call budget was exhausted.', 'budget_exceeded');
    return { ...completeState(), modelCalls: state.modelCalls };
  }

  const correctionRequest = buildTaskRequest(
    context.options.provider,
    context.options.task,
    input,
    state.budget,
    correctionInstruction,
  );
  if (correctionRequest.status === 'unsupported_input') {
    context.outcome = {
      status: 'unavailable',
      reason: 'The selected provider cannot accept this task input.',
      providerErrorCode: 'unsupported_input',
    };
    return { ...completeState(), modelCalls: state.modelCalls };
  }
  if (correctionRequest.status !== 'ready') {
    stop(context, 'The task correction request was invalid.', 'invalid_output');
    return { ...completeState(), modelCalls: state.modelCalls };
  }

  const correctionState: WorkflowState = {
    ...state,
    modelCalls: state.modelCalls + 1,
    pendingOperation: {
      kind: 'model',
      operationKey: operationKey('model', state.modelCalls + 1),
    },
  };
  // Reuse the selected provider and current evidence, then run the same local checks again.
  const onCorrectionText = createTaskTextObserver(context, input);
  if (onCorrectionText) {
    reportTaskStreamEvent(context, { type: 'started' });
    reportProgress(context, {
      type: 'model_started',
      phase: 'revised_response',
    });
  }
  const correctionOutcome = await callModelWithEvidenceFreshness(
    context,
    correctionRequest.request,
    onCorrectionText,
  );
  if (!correctionOutcome) {
    return { ...completeState(), modelCalls: correctionState.modelCalls };
  }
  if (correctionOutcome.status !== 'response') {
    return {
      ...finishModelFailure(context, correctionOutcome),
      modelCalls: correctionState.modelCalls,
    };
  }
  return {
    ...consumeResponderResponse(
      context,
      correctionState,
      correctionOutcome.response,
      input,
      true,
      true,
    ),
    modelCalls: correctionState.modelCalls,
  };
}

/** Maps provider failures without exposing request or evidence content. */
export function finishModelFailure<TResult>(
  context: RuntimeContext<TResult>,
  outcome: ModelCallOutcome,
): Partial<WorkflowState> {
  if (outcome.status === 'cancelled') canceled(context, outcome.providerStop);
  else if (outcome.status === 'consent_required') {
    stop(
      context,
      'User approval is required before this payload can be processed.',
      'consent_required',
    );
  } else if (outcome.status === 'unavailable') {
    context.outcome = {
      status: 'unavailable',
      reason: 'The selected model could not complete the request.',
      providerErrorCode: outcome.errorCode,
    };
  }
  return completeState();
}
