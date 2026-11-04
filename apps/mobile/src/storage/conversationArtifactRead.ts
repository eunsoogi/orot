import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationSourcesNotRemoved } from './conversationArtifactDependencies';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';

/** Validate a page in one transaction so hide, clear, or source deletion cannot split its snapshot. */
export function createConversationArtifactReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const history = createManualHistoryRepository(database);
  const readMany = async (
    ids: readonly string[],
  ): Promise<(ConversationArtifact | null)[]> => {
    await ensure();
    const output: (ConversationArtifact | null)[] = [];
    await database.transaction(async tx => {
      for (const id of ids) {
        const row = await tx.execute(
          'SELECT a.id, a.session_id, a.created_at, a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE a.id = ?',
          [id],
        );
        const value = decodeConversationArtifact(row.rows[0]?.result_json);
        if (
          !value ||
          value.id !== row.rows[0]?.id ||
          value.sessionId !== row.rows[0]?.session_id ||
          value.createdAt !== row.rows[0]?.created_at
        ) {
          output.push(null);
          continue;
        }
        try {
          await assertConversationSourcesNotRemoved(tx, value);
          await assertRetainedEvidenceCurrent(
            tx,
            value.sources,
            history,
            false,
          );
          output.push(value);
        } catch {
          output.push(null);
        }
      }
    });
    return output;
  };
  return {
    readMany,
    async read(id: string) {
      return (await readMany([id]))[0] ?? null;
    },
  };
}
