/** Date-only wire values must round-trip without ISO rollover or time-zone guessing. */
export function canonicalConversationDraftDate(
  value: unknown,
): string | undefined {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '2100-12-31'
  )
    return undefined;
  const instant = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(instant.getTime()) &&
    instant.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}
