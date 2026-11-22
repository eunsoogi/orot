import type { SqlExecutor } from '@orot/storage';

export type HistoricalDialogueParent = Readonly<{
  id: string;
  createdAt: string;
}>;
type PromptTurn = HistoricalDialogueParent & {
  readonly question: string;
  readonly answer: string;
};

// The permanent artifact invalidation/deletion ledgers fence even update/restore
// ABA. This projection neither accepts evidence nor establishes source freshness.
const owner = `SELECT s.id FROM conversation_artifact_sessions s
 JOIN conversation_artifact_generation g ON g.singleton=1 AND g.generation=s.generation
 WHERE s.id=? AND s.version=? AND s.hidden=0
 AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions d WHERE d.id=s.id)`;
const visible = `NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id=a.id)
 AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents d WHERE d.id=a.id)
 AND NOT EXISTS (SELECT 1 FROM conversation_requests r WHERE r.id=a.id AND r.session_id=a.session_id
   AND (r.status <> 'completed' OR r.input_json IS NOT NULL))`;
const document = `CASE WHEN json_valid(a.result_json) THEN a.result_json ELSE '{}' END`;

export function createProtectedPromptHistory(
  database: SqlExecutor,
  ensure: () => Promise<void>,
) {
  return {
    /** Read only committed text; no source blobs, attachment data or tool rows may cross. */
    async readProtectedPromptHistory(
      sessionId: string,
      version: number,
      expectedIds: readonly string[],
      signal: AbortSignal,
      includeRecent = true,
    ) {
      if (signal.aborted) return null;
      await ensure();
      if (signal.aborted) return null;
      const { rows } = await database.execute(
        `SELECT * FROM (WITH owner AS (${owner}), wanted(id) AS (SELECT value FROM json_each(?)), recent AS (
          SELECT a.id FROM conversation_artifacts a JOIN owner o ON o.id=a.session_id
          WHERE ${visible} AND ? = 1 AND NOT EXISTS (SELECT 1 FROM wanted)
          ORDER BY a.created_at DESC, a.id DESC LIMIT 4
        ), selected AS (
          SELECT id FROM recent
          UNION SELECT id FROM wanted
        ), text_rows AS (
          SELECT a.id, a.created_at, json_extract(${document}, '$.question') AS question,
            json_extract(${document}, '$.answer') AS answer
          FROM selected v JOIN conversation_artifacts a ON a.id=v.id
          JOIN owner o ON o.id=a.session_id
          WHERE ${visible}
            AND json_extract(${document}, '$.id')=a.id
            AND json_extract(${document}, '$.sessionId')=a.session_id
            AND json_extract(${document}, '$.createdAt')=a.created_at
            AND json_extract(${document}, '$.status')='complete'
            AND json_type(${document}, '$.submittedInput') IS NULL
            AND json_type(${document}, '$.treatmentContext') IS NULL
        )
        SELECT r.id, r.created_at, r.question, r.answer FROM owner o
        LEFT JOIN text_rows r ON 1 ORDER BY r.created_at ASC, r.id ASC)`,
        [
          sessionId,
          version,
          JSON.stringify([...new Set(expectedIds)]),
          Number(includeRecent),
        ],
      );
      if (signal.aborted || !rows.length) return null;
      const turns: PromptTurn[] = [];
      for (const row of rows) {
        if (
          typeof row.id === 'string' &&
          typeof row.created_at === 'string' &&
          typeof row.question === 'string' &&
          typeof row.answer === 'string'
        )
          turns.push({
            id: row.id,
            createdAt: row.created_at,
            question: row.question,
            answer: row.answer,
          });
      }
      return turns;
    },
    /** Recheck only the active owner and admitted committed identities, never sources. */
    async protectedPromptHistoryIsCurrent(
      sessionId: string,
      version: number,
      parents: readonly HistoricalDialogueParent[],
      signal: AbortSignal,
    ) {
      if (signal.aborted) return false;
      await ensure();
      if (signal.aborted) return false;
      const { rows } = await database.execute(
        `SELECT * FROM (WITH owner AS (${owner}), wanted AS (
          SELECT json_extract(value,'$.id') AS id, json_extract(value,'$.createdAt') AS created_at
          FROM json_each(?)
        )
        SELECT 1 AS current FROM owner o WHERE NOT EXISTS (
          SELECT 1 FROM wanted w WHERE NOT EXISTS (
            SELECT 1 FROM conversation_artifacts a
            WHERE a.session_id=o.id AND a.id=w.id AND a.created_at=w.created_at AND ${visible}
          )
        ))`,
        [sessionId, version, JSON.stringify(parents)],
      );
      return !signal.aborted && rows[0]?.current === 1;
    },
  };
}
