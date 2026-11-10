import { compareTimestamps, TimestampSchema } from '@orot/domain';
import { dateKey, dayFormatter, dayStart, shiftDate } from './calendarDate';
import type { HealthContextDay, HealthContextWindow } from './types';

const dayMilliseconds = 86_400_000;

/** A window contains at most 90 local calendar days; exact time bounds remain authoritative. */
export function healthContextDays(
  window: HealthContextWindow,
): HealthContextDay[] {
  const from = Date.parse(TimestampSchema.parse(window.fromInclusive));
  const to = Date.parse(TimestampSchema.parse(window.toExclusive));
  if (window.dataAvailableThrough !== undefined) {
    TimestampSchema.parse(window.dataAvailableThrough);
    if (compareTimestamps(window.dataAvailableThrough, window.toExclusive) < 0)
      throw new RangeError(
        'The data availability cutoff must cover the requested occurrence window.',
      );
  }
  if (
    compareTimestamps(window.fromInclusive, window.toExclusive) >= 0 ||
    to - from > 91 * dayMilliseconds
  )
    throw new RangeError(
      'The health context window must advance within 90 calendar days.',
    );
  const formatter = dayFormatter(window.timeZone);
  const endDate = dateKey(formatter, to);
  const exactMidnight = new Date(dayStart(endDate, formatter)).toISOString();
  // Date.parse truncates sub-millisecond digits. Only an exact midnight excludes that local day.
  const lastDate =
    compareTimestamps(window.toExclusive, exactMidnight) === 0
      ? shiftDate(endDate, -1)
      : endDate;
  const days: HealthContextDay[] = [];
  for (
    let date = dateKey(formatter, from);
    date <= lastDate;
    date = shiftDate(date, 1)
  ) {
    const start = new Date(dayStart(date, formatter)).toISOString();
    const end = new Date(dayStart(shiftDate(date, 1), formatter)).toISOString();
    // Preserve the caller's exact endpoints for SQL's precision-preserving timestamp keys.
    const clippedFrom =
      compareTimestamps(window.fromInclusive, start) > 0
        ? window.fromInclusive
        : start;
    const clippedTo =
      compareTimestamps(window.toExclusive, end) < 0 ? window.toExclusive : end;
    if (compareTimestamps(clippedFrom, clippedTo) < 0)
      days.push({
        date,
        fromInclusive: clippedFrom,
        toExclusive: clippedTo,
        partial:
          compareTimestamps(clippedFrom, start) !== 0 ||
          compareTimestamps(clippedTo, end) !== 0,
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
    compareTimestamps(
      endAt,
      new Date(dayStart(current, formatter)).toISOString(),
    ) === 0
      ? shiftDate(current, -1)
      : current;
  return {
    fromInclusive: new Date(
      dayStart(shiftDate(last, 1 - days), formatter),
    ).toISOString(),
    toExclusive: endAt,
    timeZone,
  };
}
