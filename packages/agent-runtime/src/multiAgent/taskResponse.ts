import type { LanguageModelRequest } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import type { ModelCallOutcome } from './modelCall';
import { callModelWithEvidenceFreshness } from './modelCallFreshness';
import { buildTaskRequest } from './requests';
import { consumeResponderResponse } from './responses';
import { canceled, completeState, operationKey, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

/** Applies task validation and, when explicitly requested, one bounded correction call. */
export async function consumeTaskModelResponse<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  request: LanguageModelRequest,
  input: TaskResponderInput,
  revised: boolean,
): Promise<Partial<WorkflowState>> {
  context.responseCorrectionInstruction = undefined;
  const outcome = await callModelWithEvidenceFreshness(context, request);
  if (!outcome) return completeState();
  if (outcome.status !== 'response') return finishModelFailure(context, outcome);
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
  const correctionOutcome = await callModelWithEvidenceFreshness(
    context,
    correctionRequest.request,
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
