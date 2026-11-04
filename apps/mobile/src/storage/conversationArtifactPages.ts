import type { SqlExecutor } from '@orot/storage';

/** Keyset paging keeps equal timestamps ordered without dropping older turns. */
export async function listConversationArtifactPage(
  database: SqlExecutor,
  sessionId: string,
  cursor?: { readonly createdAt: string; readonly id: string },
  limit = 50,
) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (cursor &&
      (!cursor.id ||
        !Number.isFinite(Date.parse(cursor.createdAt)) ||
        new Date(cursor.createdAt).toISOString() !== cursor.createdAt))
  )
    throw new RangeError('Invalid conversation page.');
  const result = await database.execute(
    'SELECT id, created_at FROM conversation_artifacts WHERE session_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
    [
      sessionId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const items = result.rows.slice(0, limit).map(row => {
    if (typeof row.id !== 'string' || typeof row.created_at !== 'string')
      throw new Error('Invalid conversation metadata.');
    return { id: row.id, createdAt: row.created_at };
  });
  return {
    items,
    nextCursor: result.rows.length > limit ? (items.at(-1) ?? null) : null,
  };
}
