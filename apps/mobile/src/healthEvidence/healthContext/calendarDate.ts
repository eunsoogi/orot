const dayMilliseconds = 86_400_000;

/** Format instants into the caller's explicit civil timezone. */
export function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function dateKey(
  formatter: Intl.DateTimeFormat,
  instant: number,
): string {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMilliseconds)
    .toISOString()
    .slice(0, 10);
}

/** Binary-search local midnight without treating a civil day as a fixed duration. */
export function dayStart(date: string, formatter: Intl.DateTimeFormat): number {
  const nominal = Date.parse(`${date}T00:00:00Z`);
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateKey(formatter, middle) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}
