import type {
  LanguageModelMessage,
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { toLangChainMessages, toNativeMessages } from '../langchain/messages';
import { isSourceAllowed } from './evidence';
import { guidedSchema } from './guidedSchema';
import { canonicalJson, utf8ByteLength } from './protocol';
import { completeState, stop } from './runtimeContext';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';
import { missingNativeEvidenceKind } from './nativeEvidenceRequirements';
import { canReserveToolModelCall } from './evidenceToolModelBudget';

/** Tool definitions describe capabilities only. No record is read until a model requests it. */
export function withNativeTools<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  request: LanguageModelRequest,
  requireEvidence = false,
): LanguageModelRequest {
  if (!context.options.provider.capabilities.toolCalling || context.options.tools.length === 0)
    return request;
  const requiredKind = missingNativeEvidenceKind(context);
  const offeredTools = context.options.tools.filter(
    (tool) =>
      (!requiredKind || tool.sourceKind === requiredKind) && canReserveToolModelCall(tool, state),
  );
  const available =
    offeredTools.length > 0 &&
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
      ...(available && requiredKind
        ? [
            {
              role: 'system' as const,
              content: `The task needs evidence from ${requiredKind}, which has not been searched. Choose a matching tool and its query before returning the final answer.`,
            },
          ]
        : []),
      ...nativeToolMessagesForRequest(context.nativeToolMessages),
    ],
    ...(available
      ? {
          // Conversation-capable tasks first let the model identify a non-factual reply.
          // A dependent empty-evidence result is retried with a mandatory model-selected tool.
          ...(requiredKind ||
          requireEvidence ||
          (!context.options.task.isEvidenceIndependentResult &&
            state.toolCalls === 0 &&
            state.evidenceReferences.length === 0)
            ? { toolChoice: 'required' as const }
            : {}),
          tools: offeredTools.map((tool) => ({
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
  const requiredKind = missingNativeEvidenceKind(context);
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
    (requiredKind !== undefined && tool.sourceKind !== requiredKind) ||
    !input ||
    !isSourceAllowed(context.options.execution.allowedScope, tool.sourceKind)
  ) {
    stop(context, 'The model requested an invalid or unavailable tool.', 'invalid_output');
    return completeState();
  }
  if (
    state.toolCalls >= state.budget.maxToolCalls ||
    state.modelCalls >= state.budget.maxModelCalls ||
    !canReserveToolModelCall(tool, state) ||
    state.evidenceReferences.length >= state.budget.maxEvidenceItems ||
    utf8ByteLength(canonicalJson(response)) > state.budget.maxPayloadBytes
  ) {
    stop(context, 'The model tool call exceeded the run budget.', 'budget_exceeded');
    return completeState();
  }
  context.nativeToolMessages ??= [];
  if (context.nativeToolMessages.some((message) => hasToolCallIdentity(message, call.id))) {
    stop(context, 'The model reused an existing tool call identity.', 'invalid_output');
    return completeState();
  }
  let assistantMessage: BaseMessage | undefined;
  try {
    [assistantMessage] = toLangChainMessages([
      { role: 'assistant', content: response.text, toolCalls: [call] },
    ]);
  } catch {
    stop(context, 'The model returned an invalid tool call message.', 'invalid_output');
    return completeState();
  }
  if (!assistantMessage || !AIMessage.isInstance(assistantMessage)) {
    stop(context, 'The model returned an invalid tool call message.', 'invalid_output');
    return completeState();
  }
  context.nativeToolMessages.push(assistantMessage);
  context.pendingNativeToolCallId = call.id;
  context.researchInput = input;
  return { phase: 'evidence_search', selectedToolId: tool.id, pendingOperation: undefined };
}

/** Keep standard messages between graph nodes; checkpoints retain neither tool payloads nor evidence text. */
export type NativeToolMessages = BaseMessage[];

/** Convert only when crossing back into the provider-neutral request contract. */
export function nativeToolMessagesForRequest(
  messages: NativeToolMessages | undefined,
): readonly LanguageModelMessage[] {
  return toNativeMessages(messages ?? []).messages;
}

/** Append only one serializable tool result for the graph's outstanding assistant call. */
export function appendNativeToolResultMessage(
  messages: NativeToolMessages | undefined,
  callId: string | undefined,
  result: Extract<LanguageModelMessage, { role: 'tool' }>['result'],
): boolean {
  if (!callId || !messages) return false;
  const matchingCalls = messages.reduce(
    (count, message) =>
      count +
      (AIMessage.isInstance(message)
        ? (message.tool_calls?.filter((call) => call.id === callId).length ?? 0)
        : 0),
    0,
  );
  if (
    matchingCalls !== 1 ||
    messages.some((message) => ToolMessage.isInstance(message) && message.tool_call_id === callId)
  )
    return false;
  try {
    const [toolMessage] = toLangChainMessages([{ role: 'tool', toolCallId: callId, result }]);
    if (!toolMessage || !ToolMessage.isInstance(toolMessage)) return false;
    messages.push(toolMessage);
    return true;
  } catch {
    return false;
  }
}

function hasToolCallIdentity(message: BaseMessage, callId: string): boolean {
  if (AIMessage.isInstance(message))
    return message.tool_calls?.some((call) => call.id === callId) ?? false;
  return ToolMessage.isInstance(message) && message.tool_call_id === callId;
}
