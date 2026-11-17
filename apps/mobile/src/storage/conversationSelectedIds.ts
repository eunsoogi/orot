/** Bound page reads without interpolating identities or loading unrelated private bodies. */
export function conversationSelectedIds(
  column: 'id' | 'r.id' | 'e.message_id' | 'a.id',
  ids?: readonly string[],
) {
  if (ids === undefined) return { clause: '', parameters: [] as string[] };
  if (ids.length > 50 || ids.some(id => !id || id.length > 210))
    throw new RangeError('Invalid conversation page identities.');
  return {
    clause: ids.length
      ? ` AND ${column} IN (${ids.map(() => '?').join(',')})`
      : ' AND 0',
    parameters: [...ids],
  };
}
