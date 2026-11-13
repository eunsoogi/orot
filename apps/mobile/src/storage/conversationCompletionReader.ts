import type { SqlDatabase } from '@orot/storage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';

export type ConversationCompletionIdentity = {
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly sessionVersion: number;
};

/** Resolve the completion and its fresh answer from one protected database snapshot. */
export function createConversationCompletionReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (identity: ConversationCompletionIdentity) => {
    await ensure();
    let answer: string | null = null;
    await database.transaction(async tx => {
      const result = await tx.execute(
        "SELECT a.result_json FROM conversation_completions c JOIN conversation_artifacts a ON a.id = c.message_id AND a.session_id = c.session_id JOIN conversation_artifact_sessions s ON s.id = c.session_id AND s.hidden = 0 JOIN conversation_requests r ON r.id = c.request_id AND r.session_id = c.session_id AND r.session_version = s.version AND r.status = 'completed' JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE c.request_id = ? AND c.session_id = ? AND c.message_id = ? AND s.version = ? AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)",
        [
          identity.requestId,
          identity.sessionId,
          identity.messageId,
          identity.sessionVersion,
        ],
      );
      const artifact = decodeConversationArtifact(result.rows[0]?.result_json);
      if (
        !artifact ||
        artifact.id !== identity.messageId ||
        artifact.sessionId !== identity.sessionId
      )
        return;
      try {
        await assertConversationArtifactCurrent(tx, database, artifact, false);
        answer = artifact.answer;
      } catch {
        return;
      }
    });
    return answer;
  };
}
