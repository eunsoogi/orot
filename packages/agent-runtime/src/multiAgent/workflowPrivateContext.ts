import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { toLangChainMessages, toNativeMessages } from '../langchain/messages';
import { canonicalJson, utf8ByteLength } from './protocol';
import type { RuntimeContext } from './runtimeContext';
import type { WorkflowState } from './state';

/** Only protected request-scoped journal rows contain tool messages or a prepared private query. */
export async function preparePrivateOperationContext<TResult>(
  context: RuntimeContext<TResult>,
  state: WorkflowState,
  operationKey: string,
): Promise<boolean> {
  const journal = context.options.operationJournal;
  if (!journal) return true;
  const operationId = `${operationKey}:context`;
  const binding = JSON.parse(
    JSON.stringify({
      execution: context.options.execution,
      initialSearch: context.options.initialSearch,
      phase: state.phase,
      initialSearchStatus: state.initialSearchStatus,
      modelCalls: state.modelCalls,
      toolCalls: state.toolCalls,
      researchCycles: state.researchCycles,
      selectedToolId: state.selectedToolId,
      evidenceNeed: state.evidenceNeed,
      evidenceReferences: state.evidenceReferences,
    }),
  );
  if (!state.awaitingAuthorization) {
    const input = JSON.stringify({
      binding,
      messages: toNativeMessages(context.nativeToolMessages ?? []),
      pendingCallId: context.pendingNativeToolCallId,
      researchInput: context.researchInput,
    });
    if (utf8ByteLength(input) > state.budget.maxPayloadBytes) return false;
    return (
      (
        await journal.loadOrCreate({
          operationId,
          input,
          evidenceReferences: state.evidenceReferences,
        })
      ).status === 'ready'
    );
  }
  const saved = await journal.loadPrepared?.(operationId);
  if (
    !saved ||
    saved.operationId !== operationId ||
    utf8ByteLength(saved.input) > state.budget.maxPayloadBytes
  )
    return false;
  try {
    const decoded = JSON.parse(saved.input);
    if (
      canonicalJson(decoded.binding) !== canonicalJson(binding) ||
      canonicalJson(saved.evidenceReferences) !== canonicalJson(state.evidenceReferences)
    )
      return false;
    const messages = toLangChainMessages(decoded.messages.messages, decoded.messages.metadata);
    if (decoded.pendingCallId !== undefined) {
      if (
        typeof decoded.pendingCallId !== 'string' ||
        messages.filter(
          (message) =>
            AIMessage.isInstance(message) &&
            message.tool_calls?.some((call) => call.id === decoded.pendingCallId),
        ).length !== 1 ||
        messages.some(
          (message) =>
            ToolMessage.isInstance(message) && message.tool_call_id === decoded.pendingCallId,
        )
      )
        return false;
    }
    if (state.phase === 'evidence_search') {
      const tool = context.options.tools.find((candidate) => candidate.id === state.selectedToolId);
      const input = tool?.parseInput(decoded.researchInput);
      if (!input || canonicalJson(input) !== canonicalJson(decoded.researchInput)) return false;
      context.researchInput = input;
    }
    context.nativeToolMessages = messages;
    context.pendingNativeToolCallId = decoded.pendingCallId;
    return true;
  } catch {
    return false;
  }
}
