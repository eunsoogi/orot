import type { JsonValue, LanguageModelRequest } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import { isEvidenceIndependentResult } from './evidenceIndependentResult';
import { callModelWithEvidenceFreshness } from './modelCallFreshness';
import { withNativeTools } from './nativeTools';
import { reportProgress, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { decodeTaskResponse } from './taskResponseDecoding';
import { canonicalJson, utf8ByteLength } from './protocol';
import type { createTaskTextObserver } from './taskTextObserver';

/** A conversation-capable task gets no blanket evidence exemption. If it attempts a
 * factual empty-evidence result, reserve a search and final answer within the original budget. */
export async function callConversationalResponder<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  request: LanguageModelRequest,
  input: TaskResponderInput,
  onTaskText: ReturnType<typeof createTaskTextObserver>,
) {
  const outcome = await callModelWithEvidenceFreshness(
    context,
    withNativeTools(context, state, request),
    onTaskText,
  );
  if (
    outcome?.status !== 'response' ||
    outcome.response.finishReason !== 'complete' ||
    utf8ByteLength(canonicalJson(outcome.response)) > state.budget.maxPayloadBytes ||
    !context.options.task.isEvidenceIndependentResult ||
    input.evidence.items.length ||
    state.toolCalls ||
    !input.research?.canRequestEvidence ||
    !context.options.provider.capabilities.toolCalling
  )
    return { outcome, state };
  const { output } = decodeTaskResponse<JsonValue>(outcome.response);
  if (
    output?.type !== 'result' ||
    isEvidenceIndependentResult(context.options.task, output.value, input)
  )
    return { outcome, state };
  // One call selects a tool and another answers from its result; never raise the caller's budget.
  if (state.modelCalls + 2 > state.budget.maxModelCalls) return { outcome, state };
  const nextState = { ...state, modelCalls: state.modelCalls + 1 };
  reportProgress(context, { type: 'model_started', phase: 'revised_response' });
  const requiredOutcome = await callModelWithEvidenceFreshness(
    context,
    withNativeTools(context, nextState, request, true),
    // The mandatory tool-selection call has no displayable final answer. Its tokens
    // must not concatenate a second JSON envelope into the first stream observer.
    undefined,
  );
  if (requiredOutcome?.status === 'response' && !requiredOutcome.response.toolCalls.length) {
    stop(context, 'The model did not perform the required evidence lookup.', 'invalid_output');
    return { outcome: undefined, state: nextState };
  }
  return { outcome: requiredOutcome, state: nextState };
}
