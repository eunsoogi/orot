const dayMilliseconds = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const starts = new WeakMap<Intl.DateTimeFormat, Map<string, number>>();
const monthFirstFormatters = new WeakSet<Intl.DateTimeFormat>();
const modernDateText = /^(\d{2})\/(\d{2})\/(\d{4}) AD$/u;
const maximumZones = 4;
// Scope decoding and report calculation overlap on multi-year histories.
// Keep only on-demand civil midnights, bounded independently per cached zone.
const maximumDates = 4096;

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
  // The locale can have different date patterns across OS versions. Use the
  // cheaper string formatter only after confirming its field order and era.
  const probe = Date.UTC(2024, 4, 19, 12);
  const parts = formatter.formatToParts(probe);
  const text = modernDateText.exec(formatter.format(probe));
  if (
    text &&
    parts.map(part => part.type).join(',') ===
      'month,literal,day,literal,year,literal,era' &&
    parts[0]?.value === text[1] &&
    parts[2]?.value === text[2] &&
    parts[4]?.value === text[3] &&
    parts[6]?.value === 'AD'
  )
    monthFirstFormatters.add(formatter);
  // Cache only civil-calendar machinery, never records, query results or access decisions.
  formatters.set(timeZone, formatter);
  if (formatters.size > maximumZones)
    formatters.delete(formatters.keys().next().value!);
  return formatter;
}

function localDateParts(formatter: Intl.DateTimeFormat, instant: number) {
  // Both Intl methods format the same fields. Unrecognized layouts, BCE and
  // expanded-year values still use the structured parts from the runtime.
  if (monthFirstFormatters.has(formatter)) {
    const text = modernDateText.exec(formatter.format(instant));
    if (text) return { year: Number(text[3]), month: text[1]!, day: text[2]! };
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: string) =>
    parts.find(value => value.type === type)!.value;
  // Intl uses era years; ISO uses astronomical years (1 BC is year 0000).
  const year =
    part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
  return { year, month: part('month'), day: part('day') };
}

export function dateKey(
  formatter: Intl.DateTimeFormat,
  instant: number,
): string {
  const { year, month, day } = localDateParts(formatter, instant);
  const isoYear =
    year >= 0 && year <= 9999
      ? String(year).padStart(4, '0')
      : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;
  return `${isoYear}-${month}-${day}`;
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
  const utc = new Date(nominal);
  // Compare Gregorian triples directly. The signed year remains the primary
  // key across eras, without formatting and reparsing ISO in every probe.
  const target =
    utc.getUTCFullYear() * 10000 +
    (utc.getUTCMonth() + 1) * 100 +
    utc.getUTCDate();
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  let lastSecond: number | undefined;
  let beforeTarget = false;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const second = Math.floor(middle / 1000);
    // IANA offsets and transitions are expressed in whole seconds. Reuse only
    // the date of a probe within that same UTC second, retaining every original
    // binary-search decision even when a timezone rollback repeats a civil date.
    if (second !== lastSecond) {
      const { year, month, day } = localDateParts(formatter, middle);
      beforeTarget = year * 10000 + Number(month) * 100 + Number(day) < target;
      lastSecond = second;
    }
    if (beforeTarget) low = middle + 1;
    else high = middle;
  }
  // Adjacent days and separate health topics share midnight boundaries. Keep the
  // exact timezone/DST search but avoid thousands of repeat Intl calls on JS.
  cache.set(date, low);
  if (cache.size > maximumDates) cache.delete(cache.keys().next().value!);
  starts.set(formatter, cache);
  return low;
}
