/** Bind one JSON array so selected identities do not hit a per-ID SQL parameter ceiling. */
export function conversationSelectedIds(
  column: 'id' | 'r.id' | 'e.message_id' | 'a.id',
  ids?: readonly string[],
) {
  if (ids === undefined) return { clause: '', parameters: [] as string[] };
  if (ids.some(id => !id || id.length > 210))
    throw new RangeError('Invalid conversation page identities.');
  return {
    clause: ids.length
      ? ` AND ${column} IN (SELECT value FROM json_each(?))`
      : ' AND 0',
    parameters: ids.length ? [JSON.stringify(ids)] : [],
  };
}
