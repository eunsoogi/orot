/** The legacy catalog has always ranked timezone-less SQLite timestamps as UTC.
 * Use that same clock for paging/display without rewriting the stored identity. */
export function recentMaterialTimestamp(value: string): string {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + 'Z';
}

/** Fixed SQL expressions only; a missing zone must not drop fractional digits. */
export function recentMaterialTimestampExpression(expression: string): string {
  return `(CASE WHEN upper(substr(${expression}, -1)) = 'Z' OR substr(${expression}, -6) GLOB '[+-][0-9][0-9]:[0-9][0-9]' THEN ${expression} ELSE ${expression} || 'Z' END)`;
}
