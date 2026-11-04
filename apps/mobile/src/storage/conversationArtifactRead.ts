import type { SqlDatabase } from '@orot/storage';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';

/** Validate a page in one transaction so hide, clear, or source deletion cannot split its snapshot. */
export function createConversationArtifactReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  const readManyWithLease = async (
    ids: readonly string[],
    lease?: { readonly sessionId: string; readonly version: number },
  ): Promise<(ConversationArtifact | null)[]> => {
    await ensure();
    const output: (ConversationArtifact | null)[] = [];
    await database.transaction(async tx => {
      if (lease) {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [lease.sessionId, lease.version],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
      }
      for (const id of ids) {
        const row = await tx.execute(
          'SELECT a.id, a.session_id, a.created_at, a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)',
          [id],
        );
        const value = decodeConversationArtifact(row.rows[0]?.result_json);
        if (
          !value ||
          value.id !== row.rows[0]?.id ||
          value.sessionId !== row.rows[0]?.session_id ||
          value.createdAt !== row.rows[0]?.created_at ||
          (lease && value.sessionId !== lease.sessionId)
        ) {
          output.push(null);
          continue;
        }
        try {
          await assertConversationArtifactCurrent(tx, database, value, false);
          output.push(value);
        } catch {
          output.push(null);
        }
      }
    });
    return output;
  };
  const readMany = (ids: readonly string[]) => readManyWithLease(ids);
  return {
    readMany,
    // Lease and content must share one snapshot, including when the page is empty.
    readSessionMany(
      sessionId: string,
      version: number,
      ids: readonly string[],
    ) {
      return readManyWithLease(ids, { sessionId, version });
    },
    async read(id: string) {
      return (await readMany([id]))[0] ?? null;
    },
  };
}
