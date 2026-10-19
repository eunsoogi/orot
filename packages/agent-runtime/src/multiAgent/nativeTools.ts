import type {
  LanguageModelMessage,
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { isSourceAllowed } from './evidence';
import { guidedSchema } from './guidedSchema';
import { canonicalJson, utf8ByteLength } from './protocol';
import { completeState, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

/** Tool definitions describe capabilities only. No record is read until a model requests it. */
export function withNativeTools<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  request: LanguageModelRequest,
): LanguageModelRequest {
  if (!context.options.provider.capabilities.toolCalling || context.options.tools.length === 0)
    return request;
  const available =
    state.toolCalls < state.budget.maxToolCalls &&
    state.modelCalls < state.budget.maxModelCalls &&
    state.evidenceReferences.length < state.budget.maxEvidenceItems;
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'system',
        content: available
          ? 'Use the supplied read-only tools to obtain missing evidence. Request one tool at a time. Do not fabricate a search result or emit a JSON research plan instead of calling a tool.'
          : 'The tool budget is exhausted. Answer only from returned evidence, or state that it is insufficient.',
      },
      ...(context.nativeToolMessages ?? []),
    ],
    ...(available
      ? {
          // A first evidence-free answer cannot be grounded. The model still chooses
          // the tool and query; completed empty/denied searches may end truthfully.
          ...(state.toolCalls === 0 && state.evidenceReferences.length === 0
            ? { toolChoice: 'required' as const }
            : {}),
          tools: context.options.tools.map((tool) => ({
            name: tool.id,
            description: tool.description,
            inputSchema: guidedSchema(tool.inputSchema),
          })),
        }
      : {}),
  };
}

/** Validates provider calls before entering the existing consent, scope and freshness guarded search node. */
export function consumeNativeToolCall<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  response: LanguageModelResponse,
): Partial<WorkflowState> | undefined {
  if (!response.toolCalls.length) return undefined;
  const call = response.toolCalls[0];
  const tool = call && context.options.tools.find((value) => value.id === call.name);
  let input;
  try {
    input = tool?.parseInput(call?.arguments);
  } catch {
    input = undefined;
  }
  if (
    !context.options.provider.capabilities.toolCalling ||
    response.finishReason !== 'tool_calls' ||
    response.toolCalls.length !== 1 ||
    !call?.id ||
    !tool ||
    !input ||
    !isSourceAllowed(context.options.execution.allowedScope, tool.sourceKind)
  ) {
    stop(context, 'The model requested an invalid or unavailable tool.', 'invalid_output');
    return completeState();
  }
  if (
    state.toolCalls >= state.budget.maxToolCalls ||
    state.modelCalls >= state.budget.maxModelCalls ||
    state.evidenceReferences.length >= state.budget.maxEvidenceItems ||
    utf8ByteLength(canonicalJson(response)) > state.budget.maxPayloadBytes
  ) {
    stop(context, 'The model tool call exceeded the run budget.', 'budget_exceeded');
    return completeState();
  }
  context.nativeToolMessages ??= [];
  if (
    context.nativeToolMessages.some(
      (message) => message.role === 'tool' && message.toolCallId === call.id,
    )
  ) {
    stop(context, 'The model reused a completed tool call identity.', 'invalid_output');
    return completeState();
  }
  context.nativeToolMessages.push({ role: 'assistant', content: response.text, toolCalls: [call] });
  context.pendingNativeToolCallId = call.id;
  context.researchInput = input;
  return { phase: 'evidence_search', selectedToolId: tool.id, pendingOperation: undefined };
}

/** Tool payloads remain ephemeral, like evidence text; graph checkpoints contain neither. */
export type NativeToolMessages = LanguageModelMessage[];
