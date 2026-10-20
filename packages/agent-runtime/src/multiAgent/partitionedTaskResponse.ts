import type { JsonValue, LanguageModelResponse } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import type { ModelCallOutcome } from './modelCall';
import { callModelWithEvidenceFreshness } from './modelCallFreshness';
import { buildTaskRequest } from './requests';
import { decodeTaskResponse } from './taskResponseDecoding';
import { canonicalJson, citationReferences, parseJsonOutput, utf8ByteLength } from './protocol';
import { reportProgress, reportTaskStreamEvent, stop } from './runtimeContext';
import { createTaskTextObserver, projectedTaskText } from './taskTextObserver';

/** Partition only a final, fully researched response. Every original item belongs to exactly one group. */
export function finalResultInputs<TResult>(
  context: RuntimeContext<TResult>,
  input: TaskResponderInput,
): readonly TaskResponderInput[] | undefined {
  if (!context.options.task.finalResultPartition || input.research?.canRequestEvidence !== false)
    return;
  const kinds = [...new Set(input.evidence.items.map((item) => item.sourceKind))];
  if (kinds.length < 2) return;
  return kinds.map((sourceKind, index) => ({
    ...input,
    resultPartition: { sourceKind, index, total: kinds.length },
    evidence: {
      items: input.evidence.items.filter((item) => item.sourceKind === sourceKind),
      coverage: input.evidence.coverage.filter((item) => item.sourceKind === sourceKind),
      conflicts: input.evidence.conflicts,
    },
  }));
}

interface PartitionOutcome {
  readonly modelCalls: number;
  readonly response?: LanguageModelResponse;
  readonly failure?: ModelCallOutcome;
}

/** Bound all calls before dispatch, validate each group privately, then let the caller validate the full merge.
 * Every provider call uses the existing consent, cancellation and complete-evidence freshness boundary.
 * Partial generated values never enter checkpoints or the accepted result store.
 */
export async function callPartitionedTaskResponse<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  input: TaskResponderInput,
  groups: readonly TaskResponderInput[],
): Promise<PartitionOutcome> {
  let modelCalls = state.modelCalls;
  if (modelCalls + groups.length - 1 > state.budget.maxModelCalls) {
    stop(
      context,
      'The complete partitioned result exceeds the model call budget.',
      'budget_exceeded',
    );
    return { modelCalls };
  }
  const values: JsonValue[] = [];
  const citationIds: string[] = [];
  let prefix = '';
  reportTaskStreamEvent(context, { type: 'started' });
  for (const [index, group] of groups.entries()) {
    if (index > 0) modelCalls += 1;
    const activeInput = {
      ...group,
      research: group.research && {
        ...group.research,
        candidateTools: [],
        remainingModelCalls: Math.max(0, state.budget.maxModelCalls - modelCalls),
      },
    };
    const request = buildTaskRequest(
      context.options.provider,
      context.options.task,
      activeInput,
      state.budget,
    );
    if (request.status !== 'ready') {
      stop(context, 'The partitioned task request was invalid.', 'invalid_output');
      return { modelCalls };
    }
    reportProgress(context, { type: 'model_started', phase: 'revised_response' });
    const outcome = await callModelWithEvidenceFreshness(
      context,
      {
        ...request.request,
        messages: [
          ...request.request.messages,
          // The first group must return the last verified Tool result so the
          // provider can drain its suspended callback. Later groups start fresh
          // and must not consume that completed callback a second time.
          ...(index === 0 ? (context.nativeToolMessages ?? []) : []),
          {
            role: 'system',
            content: `This is final source group ${index + 1} of ${groups.length}: ${group.resultPartition!.sourceKind}. Summarize only its supplied sources. Other source kinds are handled separately; do not report them as missing or request another search. Return the normal task result and exact citations.`,
          },
        ],
      },
      createTaskTextObserver(context, activeInput, prefix),
    );
    if (!outcome || outcome.status !== 'response') return { modelCalls, failure: outcome };
    const response = outcome.response;
    try {
      const decoded = decodeTaskResponse(response).output;
      if (
        response.finishReason !== 'complete' ||
        response.toolCalls.length ||
        utf8ByteLength(response.text) > state.budget.maxPayloadBytes ||
        utf8ByteLength(canonicalJson(parseJsonOutput(response))) > state.budget.maxPayloadBytes ||
        !decoded ||
        decoded.type !== 'result'
      )
        throw new Error('Invalid group envelope');
      const citations = citationReferences(decoded.citations, group.evidence);
      if (
        !citations ||
        (context.options.task.requireAllEvidenceCitations &&
          citations.length !== group.evidence.items.length)
      )
        throw new Error('Invalid group citations');
      const value = decoded.value as JsonValue;
      const validated = context.options.task.validateResult(value, activeInput);
      if (validated.status !== 'valid') {
        if (validated.status === 'needs_clarification')
          context.outcome = {
            status: 'needs_clarification',
            reason: 'A result group requires clarification.',
            message: validated.message,
          };
        else stop(context, 'A result group did not pass local validation.', 'invalid_output');
        return { modelCalls };
      }
      values.push(value);
      citationIds.push(...citations.map((item) => item.evidenceId));
      const text = projectedTaskText(context, group, response.text);
      if (text) prefix = [prefix, text].filter(Boolean).join('\n\n');
    } catch {
      stop(context, 'A result group did not pass local validation.', 'invalid_output');
      return { modelCalls };
    }
  }
  try {
    const value = context.options.task.finalResultPartition!.mergeValues(values, input);
    const envelope = { type: 'result', value, citations: [...new Set(citationIds)] };
    return {
      modelCalls,
      response: {
        text: canonicalJson(envelope),
        structuredOutput: envelope,
        toolCalls: [],
        finishReason: 'complete',
      },
    };
  } catch {
    stop(context, 'The complete partitioned result could not be merged.', 'invalid_output');
    return { modelCalls };
  }
}
