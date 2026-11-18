const dayMilliseconds = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const starts = new WeakMap<Intl.DateTimeFormat, Map<string, number>>();
const maximumZones = 4;
const maximumDates = 128;

/** Format instants into the caller's explicit civil timezone. */
export function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) {
    formatters.delete(timeZone);
    formatters.set(timeZone, cached);
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // Cache only civil-calendar machinery, never records, query results or access decisions.
  formatters.set(timeZone, formatter);
  if (formatters.size > maximumZones)
    formatters.delete(formatters.keys().next().value!);
  return formatter;
}

export function dateKey(
  formatter: Intl.DateTimeFormat,
  instant: number,
): string {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find(value => value.type === type)!.value;
  // Intl uses era years; ISO uses astronomical years (1 BC is year 0000).
  const year =
    part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
  const isoYear =
    year >= 0 && year <= 9999
      ? String(year).padStart(4, '0')
      : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${isoYear}-${part('month')}-${part('day')}`;
}

/** Numeric civil ordering also works across ISO expanded-year and era boundaries. */
export function civilDateTime(date: string): number {
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value))
    throw new RangeError('Invalid civil calendar date.');
  return value;
}

export function shiftDate(date: string, days: number): string {
  return new Date(civilDateTime(date) + days * dayMilliseconds)
    .toISOString()
    .split('T')[0]!;
}

/** Binary-search local midnight without treating a civil day as a fixed duration. */
export function dayStart(date: string, formatter: Intl.DateTimeFormat): number {
  const cache = starts.get(formatter) ?? new Map<string, number>();
  const cached = cache.get(date);
  if (cached !== undefined) {
    cache.delete(date);
    cache.set(date, cached);
    return cached;
  }
  const nominal = civilDateTime(date);
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (civilDateTime(dateKey(formatter, middle)) < nominal) low = middle + 1;
    else high = middle;
  }
  // Adjacent days and separate health topics share midnight boundaries. Keep the
  // exact timezone/DST search but avoid thousands of repeat Intl calls on JS.
  cache.set(date, low);
  if (cache.size > maximumDates) cache.delete(cache.keys().next().value!);
  starts.set(formatter, cache);
  return low;
}
