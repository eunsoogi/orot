import type { JsonValue, LanguageModelResponse } from '@orot/model-runtime';
import type { TaskResponderContract, TaskResponderInput } from './contracts';
import {
  citationReferences,
  parseJsonOutput,
  parseResearchPlan,
  parseTaskOutput,
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
      coverage: input.evidence.coverage,
    };
    return completeState();
  }
  context.outcome = { status: 'result', value: validation.value, citations };
  return {
    ...completeState(),
    evidenceReferences: input.evidence.items.map(
      ({ content: _content, ...reference }) => reference,
    ),
  };
}

export function decodeResearchPlan(response: LanguageModelResponse): ResearchPlan | undefined {
  if (response.finishReason !== 'complete' || response.toolCalls.length > 0) return undefined;
  try {
    return parseResearchPlan(parseJsonOutput(response));
  } catch {
    return undefined;
  }
}

export function requireTaskContract<TResult>(contract: TaskResponderContract<TResult>): boolean {
  return Boolean(
    contract.taskType.trim() && contract.taskVersion.trim() && contract.systemPrompt.trim(),
  );
}
