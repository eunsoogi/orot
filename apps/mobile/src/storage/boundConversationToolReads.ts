import type { SourceOpenTiming } from '../providers/sourceOpenDiagnostic';
import type { conversationToolSnapshotReader } from './conversationToolSnapshot';

/** Strict bound source lookups may be retired by their specific navigation owner. */
export function boundConversationToolReads(
  readSnapshot: ReturnType<typeof conversationToolSnapshotReader>,
) {
  return {
    async readToolCall(
      sessionId: string,
      runId: string,
      callId: string,
      messageId?: string,
      timing?: SourceOpenTiming,
      signal?: AbortSignal,
    ) {
      return (
        await readSnapshot(
          sessionId,
          undefined,
          messageId ? [messageId] : undefined,
          true,
          { runId, callId },
          timing,
          signal,
        )
      ).items[0];
    },
    async readToolTurns(
      sessionId: string,
      expectedVersion?: number,
      selectedIds?: readonly string[],
      timing?: SourceOpenTiming,
      signal?: AbortSignal,
    ) {
      return (
        await readSnapshot(
          sessionId,
          expectedVersion,
          selectedIds,
          true,
          undefined,
          timing,
          signal,
        )
      ).items;
    },
  };
}
