const SORTABLE_EPOCH_OFFSET_SECONDS = 100_000_000_000;
const FRACTION_PATTERN = /\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i;

/** Encodes ISO instants for exact lexical order without collapsing source fractions. */
export function localQueryTimestampKey(timestamp: string): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error('A local query timestamp is invalid.');

  const seconds = Math.floor(milliseconds / 1000) + SORTABLE_EPOCH_OFFSET_SECONDS;
  const fraction = (timestamp.match(FRACTION_PATTERN)?.[1] ?? '').replace(/0+$/, '');
  return `${String(seconds).padStart(12, '0')}.${fraction}!`;
}

/** Builds the matching SQLite key; the caller must pass a fixed source expression. */
export function localQueryTimestampKeyExpression(sourceExpression: string): string {
  const zoneLength = `CASE WHEN substr(${sourceExpression}, -1) IN ('Z', 'z') THEN 1 ELSE 6 END`;
  const fraction =
    `CASE WHEN substr(${sourceExpression}, 20, 1) = '.' ` +
    `THEN rtrim(substr(${sourceExpression}, 21, length(${sourceExpression}) - 20 - (${zoneLength})), '0') ` +
    `ELSE '' END`;
  const epochSeconds =
    `CAST(strftime('%s', upper(${sourceExpression})) AS INTEGER) ` +
    `+ ${SORTABLE_EPOCH_OFFSET_SECONDS}`;

  // The terminator sorts before digits so variable-length decimal fractions keep numeric order.
  return `printf('%012d', ${epochSeconds}) || '.' || ${fraction} || '!'`;
}
