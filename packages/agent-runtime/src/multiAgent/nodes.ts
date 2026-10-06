import type { JsonObject, LanguageModelRequest } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import { isSourceAllowed } from './evidence';
import { callModel } from './modelCall';
import { buildResearchRequest, buildTaskRequest } from './requests';
import { decodeResearchPlan, consumeResponderResponse } from './responses';
import { canceled, completeState, operationKey, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { canonicalJson, utf8ByteLength } from './protocol';
import { createSearchNodes } from './searchNodes';

// These nodes implement the role handoff; search remains a selected deterministic tool call.
export function createNodes<TResult>(context: RuntimeContext<TResult>) {
  const { options } = context;
  const searchNodes = createSearchNodes(context);
  const prepareResponder = async (
    state: WorkflowState,
    phase: 'task_response' | 'revised_response' = 'task_response',
  ) => {
    if (context.signal.aborted) {
      canceled(context);
      return completeState();
    }
    if (state.modelCalls >= state.budget.maxModelCalls) {
      stop(context, 'The model call budget was exhausted.', 'budget_exceeded');
      return completeState();
    }
    return {
      phase,
      modelCalls: state.modelCalls + 1,
      pendingOperation: {
        kind: 'model' as const,
        operationKey: operationKey('model', state.modelCalls + 1),
      },
      terminal: false,
    };
  };

  const invokeResponder = async (state: WorkflowState) => {
    if (state.pendingOperation?.kind !== 'model') {
      stop(context, 'The responder handoff was incomplete.', 'invalid_output');
      return completeState();
    }
    const input = {
      request: options.request,
      context: options.context,
      evidence: context.currentEvidence,
    };
    const request = buildTaskRequest(options.provider, options.task, input, state.budget);
    if (request.status === 'unsupported_input') {
      context.outcome = {
        status: 'unavailable',
        reason: 'The selected provider cannot accept this task input.',
        providerErrorCode: 'unsupported_input',
      };
      return completeState();
    }
    if (request.status !== 'ready') {
      stop(context, 'The task responder request was invalid.', 'invalid_output');
      return completeState();
    }
    return consumeModelResponse(state, request.request, input, false);
  };

  const prepareResearcher = async (state: WorkflowState) => {
    if (context.signal.aborted) {
      canceled(context);
      return completeState();
    }
    if (
      !state.evidenceNeed ||
      options.tools.length === 0 ||
      state.researchCycles >= state.budget.maxResearchCycles ||
      state.modelCalls >= state.budget.maxModelCalls
    ) {
      stop(context, 'No bounded evidence search is available for this request.');
      return completeState();
    }
    return {
      phase: 'evidence_research' as const,
      modelCalls: state.modelCalls + 1,
      researchCycles: state.researchCycles + 1,
      pendingOperation: {
        kind: 'model' as const,
        operationKey: operationKey('model', state.modelCalls + 1),
      },
      terminal: false,
    };
  };

  const invokeResearcher = async (state: WorkflowState) => {
    if (!state.evidenceNeed || state.pendingOperation?.kind !== 'model') {
      stop(context, 'The evidence research handoff was incomplete.', 'invalid_output');
      return completeState();
    }
    const request = buildResearchRequest(
      options.provider,
      options.request,
      state.evidenceNeed,
      options.execution.allowedScope,
      options.tools,
      state.budget,
    );
    const outcome = await callModel(
      options.provider,
      request,
      options.execution,
      options.consent,
      context.signal,
    );
    if (outcome.status !== 'response') return finishModelFailure(outcome);
    const plan = decodeResearchPlan(outcome.response, state.budget.maxPayloadBytes);
    const tool = plan && options.tools.find((candidate) => candidate.id === plan.toolId);
    let input: JsonObject | undefined;
    try {
      input = tool && plan ? tool.parseInput(plan.input) : undefined;
    } catch {
      input = undefined;
    }
    if (
      !plan ||
      !tool ||
      plan.sourceKind !== tool.sourceKind ||
      !isSourceAllowed(options.execution.allowedScope, tool.sourceKind) ||
      !input
    ) {
      stop(
        context,
        'The researcher selected an invalid or out-of-scope tool input.',
        'invalid_output',
      );
      return completeState();
    }
    if (utf8ByteLength(canonicalJson(input)) > state.budget.maxPayloadBytes) {
      stop(context, 'The researcher tool input exceeded the payload limit.', 'budget_exceeded');
      return completeState();
    }
    context.researchInput = input;
    return {
      phase: 'evidence_search' as const,
      selectedToolId: plan.toolId,
      pendingOperation: undefined,
    };
  };

  const prepareRevision = async (state: WorkflowState) =>
    prepareResponder(state, 'revised_response');
  const invokeRevision = async (state: WorkflowState) => {
    if (state.pendingOperation?.kind !== 'model') {
      stop(context, 'The revision handoff was incomplete.', 'invalid_output');
      return completeState();
    }
    const input = {
      request: options.request,
      context: options.context,
      evidence: context.currentEvidence,
    };
    const request = buildTaskRequest(options.provider, options.task, input, state.budget);
    if (request.status === 'unsupported_input') {
      context.outcome = {
        status: 'unavailable',
        reason: 'The selected provider cannot accept this task input.',
        providerErrorCode: 'unsupported_input',
      };
      return completeState();
    }
    if (request.status !== 'ready') {
      stop(context, 'The revised task request was invalid.', 'invalid_output');
      return completeState();
    }
    return consumeModelResponse(state, request.request, input, true);
  };

  return {
    prepareResponder,
    invokeResponder,
    prepareResearcher,
    invokeResearcher,
    ...searchNodes,
    prepareRevision,
    invokeRevision,
  };

  async function consumeModelResponse(
    state: WorkflowState,
    request: LanguageModelRequest,
    input: TaskResponderInput,
    revised: boolean,
  ) {
    const outcome = await callModel(
      options.provider,
      request,
      options.execution,
      options.consent,
      context.signal,
    );
    if (outcome.status !== 'response') return finishModelFailure(outcome);
    return consumeResponderResponse(context, state, outcome.response, input, revised);
  }

  function finishModelFailure(outcome: Awaited<ReturnType<typeof callModel>>) {
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
}
