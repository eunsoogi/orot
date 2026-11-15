/** An earlier optional review can remain uncertain without replaying it.
 * Only a later, never-dispatched model approval boundary can advance independently.
 * The caller still binds exact checkpoint bytes, owner, epoch, current sources and consent.
 */
export function mayContinuePastOptionalReview(
  rawBoundary: unknown,
  uncertain: readonly Record<string, unknown>[],
): boolean {
  if (!uncertain.length) return true;
  if (typeof rawBoundary !== 'string') return false;
  try {
    const boundary = JSON.parse(rawBoundary);
    const next = /^model-([1-9]\d*)$/u.exec(
      boundary.awaitingAuthorization ?? '',
    );
    if (
      boundary.phase !== 'revised_response' ||
      boundary.pendingOperation !== false ||
      boundary.terminal !== false ||
      !next ||
      !Number.isSafeInteger(Number(next[1]))
    )
      return false;
    return uncertain.every(row => {
      const previous = /^model-([1-9]\d*):call-([1-9]\d*)$/u.exec(
        String(row.operation_id),
      );
      return (
        row.status === 'pending' &&
        row.purpose === 'preview_review' &&
        previous &&
        Number.isSafeInteger(Number(previous[1])) &&
        Number.isSafeInteger(Number(previous[2])) &&
        Number(previous[1]) < Number(next[1])
      );
    });
  } catch {
    return false;
  }
}
