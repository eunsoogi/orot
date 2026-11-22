import type { SqlDatabase } from '@orot/storage';
import type { ArchivedConversationPresentationMetadata } from './archivedConversationPresentationMetadata';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';

/** Store an app-owned follow-up on the exact active checkpoint, not as AI evidence. */
export function createConversationLocalOutcomeStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (input: {
    id: string;
    sessionId: string;
    version: number;
    question: string;
    createdAt: string;
    display: ArchivedConversationPresentationMetadata;
    current: () => boolean;
    signal: AbortSignal;
  }) => {
    const { id, sessionId, version, question, createdAt, display, signal } =
      input;
    const serialized = JSON.stringify({ kind: 'visit-goal', ...display });
    const assertCurrent = () => {
      assertConversationNotCancelled(signal);
      if (!input.current()) throw new Error('Conversation is unavailable.');
    };
    assertCurrent();
    await ensure();
    let committed = false;
    await database
      .transaction(async tx => {
        assertCurrent();
        const wrote = await tx.execute(
          `UPDATE conversation_requests AS r SET status = 'completed', interruption_reason = NULL, local_outcome_json = ?
         WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? AND r.question = ? AND r.created_at = ?
           AND r.status = 'active' AND r.input_json IS NULL AND r.local_outcome_json IS NULL
           AND EXISTS (SELECT 1 FROM conversation_artifact_sessions s
             JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
             WHERE s.id = r.session_id AND s.version = r.session_version AND s.hidden = 0)
           AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id = r.session_id)
           AND NOT EXISTS (SELECT 1 FROM conversation_artifacts x WHERE x.id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_completions x WHERE x.request_id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id = r.id)
           AND NOT EXISTS (SELECT 1 FROM conversation_request_sources x WHERE x.request_id = r.id)`,
          [serialized, id, sessionId, version, question, createdAt],
        );
        if (wrote.rowsAffected !== 1)
          throw new Error('Conversation is unavailable.');
        // The pinned driver commits synchronously. A stale local outcome cannot
        // pass a final check and then wait at the driver's implicit commit.
        assertCurrent();
        tx.commit();
        committed = true;
      })
      .catch(error => {
        // An outer settlement error cannot undo a synchronous successful commit.
        if (!committed) throw error;
      });
  };
}
