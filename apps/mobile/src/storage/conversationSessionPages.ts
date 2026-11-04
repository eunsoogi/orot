import type { SqlExecutor } from '@orot/storage';

type SessionCursor = { readonly updatedAt: string; readonly id: string };

/** Live pages contain no private text; callers accumulating pages must deduplicate moved sessions. */
export async function listConversationSessionPage(
  database: SqlExecutor,
  cursor?: SessionCursor,
  limit = 50,
) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (cursor &&
      (!cursor.id ||
        !Number.isFinite(Date.parse(cursor.updatedAt)) ||
        new Date(cursor.updatedAt).toISOString() !== cursor.updatedAt))
  )
    throw new RangeError('Invalid conversation session page.');
  const result = await database.execute(
    `SELECT s.id, s.version, MAX(a.created_at) AS updated_at
     FROM conversation_artifact_sessions s
     JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
     JOIN conversation_artifacts a ON a.session_id = s.id
     WHERE s.hidden = 0 AND typeof(s.id) = 'text' AND length(s.id) > 0
       AND typeof(s.version) = 'integer' AND s.version BETWEEN 0 AND 9007199254740991
       AND a.created_at = strftime('%Y-%m-%dT%H:%M:%fZ', julianday(a.created_at))
     GROUP BY s.id, s.version
     HAVING (? IS NULL OR MAX(a.created_at) < ? OR (MAX(a.created_at) = ? AND s.id < ?))
     ORDER BY updated_at DESC, s.id DESC LIMIT ?`,
    [
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = result.rows.slice(0, limit).map(row => {
    if (
      typeof row.id !== 'string' ||
      typeof row.updated_at !== 'string' ||
      typeof row.version !== 'number' ||
      !Number.isSafeInteger(row.version) ||
      row.version < 0 ||
      !Number.isFinite(Date.parse(row.updated_at)) ||
      new Date(row.updated_at).toISOString() !== row.updated_at
    )
      throw new Error('Invalid conversation session metadata.');
    return { id: row.id, updatedAt: row.updated_at, version: row.version };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      result.rows.length > limit && last
        ? { id: last.id, updatedAt: last.updatedAt }
        : null,
  };
}
