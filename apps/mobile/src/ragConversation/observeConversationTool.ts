import {
  projectConversationToolEvent,
  type ConversationToolEvent,
  type EvidenceSearchTool,
} from '@orot/agent-runtime';

/** Include the existing consent-checked public preflight without changing its networking policy. */
export function observeConversationTool(
  tool: EvidenceSearchTool | undefined,
  onEvent?: (event: ConversationToolEvent) => void,
): EvidenceSearchTool | undefined {
  if (!tool || !onEvent) return tool;
  return {
    ...tool,
    parseInput: value => tool.parseInput(value),
    async search(request, runtime) {
      const event: ConversationToolEvent = {
        version: 1,
        operationRunId: request.operationRunId,
        callId: request.operationKey,
        toolName: tool.id,
        order: 0,
        status: 'started',
        inputSummary: { sourceKind: tool.sourceKind },
        sources: [],
      };
      const emit = (value: ConversationToolEvent) => {
        const safe = projectConversationToolEvent(value);
        try {
          if (safe) onEvent(safe);
        } catch {
          /* Observer errors cannot change consent or search. */
        }
      };
      emit(event);
      try {
        const result = await tool.search(request, runtime);
        emit({
          ...event,
          status: request.signal.aborted
            ? 'cancelled'
            : 'status' in result
              ? 'failed'
              : 'completed',
          ...('status' in result
            ? {}
            : {
                resultSummary: { referenceCount: result.items.length },
                sources: result.items,
              }),
        });
        return result;
      } catch (error) {
        emit({
          ...event,
          status: request.signal.aborted ? 'cancelled' : 'failed',
        });
        throw error;
      }
    },
  };
}
