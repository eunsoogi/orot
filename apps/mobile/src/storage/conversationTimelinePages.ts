import type { SqlDatabase } from '@orot/storage';
import type { ConversationHistoryCursor } from '../ragConversation/conversationHistoryPage';
import { treatmentArtifactPredicate } from './treatmentSessionIdentity';

/** Select only timeline metadata. Bodies and source validation are limited to the chosen page. */
export function conversationTimelinePages(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    sessionId: string,
    version: number,
    cursor?: ConversationHistoryCursor,
    limit = 10,
  ) => {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      (cursor &&
        (cursor.version !== version ||
          !cursor.id ||
          cursor.id.length > 210 ||
          !['turn', 'task'].includes(cursor.kind) ||
          !Number.isFinite(Date.parse(cursor.createdAt)) ||
          new Date(cursor.createdAt).toISOString() !== cursor.createdAt))
    )
      throw new RangeError('Invalid conversation timeline cursor.');
    await ensure();
    let page!: {
      items: ConversationHistoryCursor[];
      nextCursor: ConversationHistoryCursor | null;
    };
    await database.transaction(async tx => {
      const lease = await tx.execute(
        'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
        [sessionId, version],
      );
      if (!lease.rows.length) throw new Error('Conversation is unavailable.');
      // A completed artifact and its tool events form one turn. Requests take precedence over
      // tool timestamps to match the existing restoration order; cards occupy their own key space.
      const result = await tx.execute(
        `SELECT * FROM (WITH candidates AS (
        SELECT a.id, a.created_at, 'turn' AS kind, 1 AS priority FROM conversation_artifacts a WHERE a.session_id = ? AND NOT (${treatmentArtifactPredicate})
        UNION ALL SELECT message_id, MAX(created_at), 'turn', 2 FROM conversation_tool_events WHERE session_id = ? GROUP BY message_id
        UNION ALL SELECT id, created_at, 'turn', 3 FROM conversation_requests WHERE session_id = ? AND session_version = ? AND status = 'interrupted'
        UNION ALL SELECT id, created_at, 'task', 2 FROM conversation_task_cards WHERE session_id = ?
        UNION ALL SELECT 'treatment:' || a.id, a.created_at, 'task', 1 FROM conversation_artifacts a WHERE a.session_id = ? AND (${treatmentArtifactPredicate})
      ), chosen AS (
        SELECT id, created_at, kind, ROW_NUMBER() OVER (PARTITION BY id, kind ORDER BY priority DESC) AS rank FROM candidates
      ) SELECT id, created_at, kind FROM chosen WHERE rank = 1
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND (id < ? OR (id = ? AND kind < ?))))
        ORDER BY created_at DESC, id DESC, kind DESC LIMIT ?)`,
        [
          sessionId,
          sessionId,
          sessionId,
          version,
          sessionId,
          sessionId,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          cursor?.id ?? null,
          cursor?.kind ?? null,
          limit + 1,
        ],
      );
      const items: ConversationHistoryCursor[] = result.rows
        .slice(0, limit)
        .map(row => {
          if (
            typeof row.id !== 'string' ||
            !row.id ||
            row.id.length > 210 ||
            typeof row.created_at !== 'string' ||
            !Number.isFinite(Date.parse(row.created_at)) ||
            new Date(row.created_at).toISOString() !== row.created_at ||
            (row.kind !== 'turn' && row.kind !== 'task')
          )
            throw new Error('Invalid conversation timeline metadata.');
          return {
            id: row.id,
            createdAt: row.created_at,
            kind: row.kind,
            version,
          };
        });
      page = {
        items,
        nextCursor: result.rows.length > limit ? (items.at(-1) ?? null) : null,
      };
    });
    return page;
  };
}
