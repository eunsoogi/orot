import type { JsonValue, LanguageModelResponse } from '@orot/model-runtime';
import type {
  TaskClarificationValue,
  TaskResponderContract,
  TaskResponderInput,
  TaskResultValidation,
} from './contracts';
import { hasIncompleteCoverage, referencesFromBatch } from './evidence';
import {
  canonicalJson,
  citationReferences,
  parseJsonOutput,
  parseResearchPlan,
  parseTaskOutput,
  utf8ByteLength,
} from './protocol';
import type { ResearchPlan } from './protocol';
import { completeState, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

export function consumeResponderResponse<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  response: LanguageModelResponse,
  input: TaskResponderInput,
  revised: boolean,
): Partial<WorkflowState> {
  if (context.signal.aborted) {
    context.outcome = context.timedOut()
      ? { status: 'budget_exceeded', reason: 'The run exceeded its time limit.' }
      : { status: 'cancelled', providerStop: 'underlying_call_unconfirmed' };
    return completeState();
  }
  if (response.finishReason !== 'complete' || response.toolCalls.length > 0) {
    stop(
      context,
      'The selected model returned an incomplete or unsupported response.',
      'invalid_output',
    );
    return completeState();
  }
  if (outputExceedsLimit(response, state.budget.maxPayloadBytes)) {
    stop(context, 'The task responder output exceeded the payload limit.', 'budget_exceeded');
    return completeState();
  }
  let decoded;
  try {
    decoded = parseTaskOutput<TResult>(parseJsonOutput(response));
  } catch {
    decoded = undefined;
  }
  if (!decoded) {
    stop(context, 'The task responder returned malformed structured output.', 'invalid_output');
    return completeState();
  }
  if (decoded.type === 'request_evidence') {
    if (revised || state.researchCycles >= state.budget.maxResearchCycles) {
      stop(context, 'The task still needs evidence after the bounded research cycle.');
      return completeState();
    }
    return {
      phase: 'evidence_research',
      evidenceNeed: decoded.need,
      pendingOperation: undefined,
    };
  }
  if (hasIncompleteCoverage(input.evidence)) {
    let taskClarificationMessage: string | undefined;
    try {
      const validation = context.options.task.validateResult(decoded.value as JsonValue, input);
      taskClarificationMessage = clarificationMessageFromValidation(validation);
    } catch {
      // A validator failure cannot make incomplete evidence sufficient.
    }
    context.outcome = {
      status: 'needs_clarification',
      reason: 'The available evidence has gaps, conflicts, truncation, or no coverage.',
      // Incomplete coverage still blocks results; only task-approved resolution copy may pass.
      ...(taskClarificationMessage ? { message: taskClarificationMessage } : {}),
      coverage: input.evidence.coverage,
    };
    return completeState();
  }
  const citations = citationReferences(decoded.citations, input.evidence);
  if (!citations) {
    stop(
      context,
      'The result cited evidence outside the current validated evidence set.',
      'invalid_output',
    );
    return completeState();
  }
  let validation;
  try {
    validation = context.options.task.validateResult(decoded.value as JsonValue, input);
  } catch {
    validation = { status: 'invalid' as const, reason: 'Task validation failed.' };
  }
  if (validation.status === 'invalid') {
    stop(context, 'The task result did not pass local validation.', 'invalid_output');
    return completeState();
  }
  if (validation.status === 'needs_clarification') {
    context.outcome = {
      status: 'needs_clarification',
      reason: 'The task requires clarification before it can return a result.',
      // Keep task-approved copy distinct from generic runtime failure reasons.
      message: validation.message,
      coverage: input.evidence.coverage,
    };
    return completeState();
  }
  context.outcome = { status: 'result', value: validation.value, citations };
  return {
    ...completeState(),
    evidenceReferences: referencesFromBatch(input.evidence),
  };
}

export function decodeResearchPlan(
  response: LanguageModelResponse,
  maxPayloadBytes: number,
): ResearchPlan | undefined {
  if (response.finishReason !== 'complete' || response.toolCalls.length > 0) return undefined;
  if (outputExceedsLimit(response, maxPayloadBytes)) return undefined;
  try {
    return parseResearchPlan(parseJsonOutput(response));
  } catch {
    return undefined;
  }
}

function outputExceedsLimit(response: LanguageModelResponse, maxPayloadBytes: number): boolean {
  if (utf8ByteLength(response.text) > maxPayloadBytes) return true;
  try {
    return utf8ByteLength(canonicalJson(parseJsonOutput(response))) > maxPayloadBytes;
  } catch {
    return false;
  }
}

export function requireTaskContract<TResult>(contract: TaskResponderContract<TResult>): boolean {
  return Boolean(
    contract.taskType.trim() && contract.taskVersion.trim() && contract.systemPrompt.trim(),
  );
}

/** Projects copy only from an explicit clarification result returned by task validation. */
function clarificationMessageFromValidation(
  validation: TaskResultValidation<unknown>,
): string | undefined {
  if (validation.status === 'needs_clarification') return validation.message;
  if (validation.status !== 'valid' || !isTaskClarificationValue(validation.value))
    return undefined;
  return validation.value.message;
}

/** Some task result unions carry their validated clarification as a normal valid value. */
function isTaskClarificationValue(value: unknown): value is TaskClarificationValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === 'needs_clarification' &&
    typeof candidate.message === 'string' &&
    candidate.message.trim().length > 0
  );
}
