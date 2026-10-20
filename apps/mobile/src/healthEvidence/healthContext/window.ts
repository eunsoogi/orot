import { TimestampSchema } from '@orot/domain';
import type { HealthContextDay, HealthContextWindow } from './types';

const dayMilliseconds = 86_400_000;

function dayFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function dateKey(formatter: Intl.DateTimeFormat, instant: number): string {
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) =>
    parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMilliseconds)
    .toISOString()
    .slice(0, 10);
}

/** Find calendar boundaries in the requested IANA zone, including DST and skipped local midnights. */
function dayStart(date: string, formatter: Intl.DateTimeFormat): number {
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

/** A window contains at most 90 local calendar days; exact time bounds remain authoritative. */
export function healthContextDays(
  window: HealthContextWindow,
): HealthContextDay[] {
  const from = Date.parse(TimestampSchema.parse(window.fromInclusive));
  const to = Date.parse(TimestampSchema.parse(window.toExclusive));
  if (from >= to || to - from > 91 * dayMilliseconds)
    throw new RangeError(
      'The health context window must advance within 90 calendar days.',
    );
  const formatter = dayFormatter(window.timeZone);
  const days: HealthContextDay[] = [];
  for (
    let date = dateKey(formatter, from);
    date <= dateKey(formatter, to - 1);
    date = shiftDate(date, 1)
  ) {
    const start = dayStart(date, formatter);
    const end = dayStart(shiftDate(date, 1), formatter);
    const clippedFrom = Math.max(start, from);
    const clippedTo = Math.min(end, to);
    if (clippedFrom < clippedTo)
      days.push({
        date,
        fromInclusive: new Date(clippedFrom).toISOString(),
        toExclusive: new Date(clippedTo).toISOString(),
        partial: clippedFrom !== start || clippedTo !== end,
      });
    if (days.length > 90)
      throw new RangeError(
        'The health context window exceeds 90 calendar days.',
      );
  }
  return days;
}

/** Defaults count local days, rather than assuming every day lasts 24 hours. */
export function recentHealthContextWindow(
  days: 7 | 30 | 90,
  endAt = new Date().toISOString(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): HealthContextWindow {
  const to = Date.parse(TimestampSchema.parse(endAt));
  const formatter = dayFormatter(timeZone);
  const current = dateKey(formatter, to);
  const last =
    dayStart(current, formatter) === to ? shiftDate(current, -1) : current;
  return {
    fromInclusive: new Date(
      dayStart(shiftDate(last, 1 - days), formatter),
    ).toISOString(),
    toExclusive: endAt,
    timeZone,
  };
}
