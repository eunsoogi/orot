const SUBMILLISECOND_PATTERN = /\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/iu;

// Match @orot/domain's comparison: Date.parse handles zones, then the remaining fraction keeps sub-ms order.
export function comparePreciseTimestamps(left: string, right: string): number | undefined {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  if (!Number.isFinite(leftMilliseconds) || !Number.isFinite(rightMilliseconds)) return undefined;
  if (leftMilliseconds !== rightMilliseconds) return leftMilliseconds < rightMilliseconds ? -1 : 1;

  const leftFraction = (left.match(SUBMILLISECOND_PATTERN)?.[1] ?? '').slice(3);
  const rightFraction = (right.match(SUBMILLISECOND_PATTERN)?.[1] ?? '').slice(3);
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeft = leftFraction.padEnd(precision, '0');
  const normalizedRight = rightFraction.padEnd(precision, '0');
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

export function isOrderedTimestampRange(fromInclusive: string, toExclusive: string): boolean {
  const comparison = comparePreciseTimestamps(fromInclusive, toExclusive);
  return comparison !== undefined && comparison < 0;
}

export function exceedsTimestampDuration(
  fromInclusive: string,
  toExclusive: string,
  maximumMilliseconds: number,
): boolean {
  const fromMilliseconds = Date.parse(fromInclusive);
  if (!Number.isFinite(fromMilliseconds)) return true;
  const extraFraction = (fromInclusive.match(SUBMILLISECOND_PATTERN)?.[1] ?? '').slice(3);
  const maximumEnd = new Date(fromMilliseconds + maximumMilliseconds)
    .toISOString()
    .replace(/Z$/u, `${extraFraction}Z`);
  const comparison = comparePreciseTimestamps(toExclusive, maximumEnd);
  return comparison === undefined || comparison > 0;
}
