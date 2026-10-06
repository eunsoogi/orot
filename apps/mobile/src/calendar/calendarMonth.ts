import type { CalendarEvent } from './types';

export interface CalendarGridDay {
  dateKey: string;
  dayNumber: number;
  belongsToMonth: boolean;
}

export interface CalendarEventDayRange {
  startDay: string;
  endDay: string;
}

export interface CalendarQueryWindow {
  startDay: string;
  endDay: string;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const FLOATING_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/u;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
// Reuse the formatter because each visible month creates 35–42 date labels.
const CALENDAR_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  calendar: 'gregory',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric',
});

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function calendarDateKey(
  year: number,
  month: number,
  day: number,
): string {
  const date = new Date(Date.UTC(year, month, day));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

function dateKeyFromDate(date: Date): string {
  return calendarDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function dateFromKey(dateKey: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return dateKeyFromDate(date) === dateKey ? date : null;
}

function floatingDateTime(value: string | null | undefined): Date | null {
  if (!value || !FLOATING_DATE_TIME_PATTERN.test(value)) return null;
  const timestamp = `${value}Z`;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && date.toISOString() === timestamp
    ? date
    : null;
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function validTimeZone(candidate: string | null): string {
  if (candidate) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: candidate,
      }).resolvedOptions().timeZone;
    } catch {
      // Invalid stored zone identifiers fall back to the device's local zone.
    }
  }
  return localTimeZone();
}

function dateKeyInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(value => value.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * Return the civil-day interval that an event occupies in its stored calendar
 * timezone. Calendar all-day end values are exclusive, so the final visible
 * day is derived from the last included instant.
 */
export function calendarEventDayRange(
  event: CalendarEvent,
): CalendarEventDayRange | null {
  const snapshot = event.calendarEventSnapshot;
  const floating = snapshot.timeZoneIdentifier === null;
  const floatingStart = floating
    ? floatingDateTime(snapshot.floatingStartAt)
    : null;
  const floatingEnd = floating
    ? floatingDateTime(snapshot.floatingEndAt)
    : null;
  const hasFloatingRange = floatingStart !== null && floatingEnd !== null;
  const start = hasFloatingRange ? floatingStart : new Date(event.effectiveAt);
  const end = hasFloatingRange ? floatingEnd : new Date(event.endsAt);
  if (!Number.isFinite(start.getTime())) return null;

  const endTime = Number.isFinite(end.getTime())
    ? end.getTime()
    : start.getTime();
  const lastIncluded = new Date(
    Math.max(
      start.getTime(),
      endTime > start.getTime() ? endTime - 1 : endTime,
    ),
  );
  const timeZone = validTimeZone(snapshot.timeZoneIdentifier);
  const startDay = hasFloatingRange
    ? dateKeyFromDate(start)
    : dateKeyInZone(start, timeZone);
  const endDay = hasFloatingRange
    ? dateKeyFromDate(lastIncluded)
    : dateKeyInZone(lastIncluded, timeZone);
  if (!dateFromKey(startDay) || !dateFromKey(endDay) || endDay < startDay) {
    return null;
  }
  return { startDay, endDay };
}

export function calendarMonthGrid(
  year: number,
  month: number,
): CalendarGridDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const normalizedYear = firstOfMonth.getUTCFullYear();
  const normalizedMonth = firstOfMonth.getUTCMonth();
  const leadingDays = firstOfMonth.getUTCDay();
  const dayCount = new Date(
    Date.UTC(normalizedYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  const weekCount = Math.ceil((leadingDays + dayCount) / 7);

  return Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(
      Date.UTC(normalizedYear, normalizedMonth, index - leadingDays + 1),
    );
    return {
      dateKey: dateKeyFromDate(date),
      dayNumber: date.getUTCDate(),
      belongsToMonth:
        date.getUTCFullYear() === normalizedYear &&
        date.getUTCMonth() === normalizedMonth,
    };
  });
}

export function shiftCalendarMonth(
  year: number,
  month: number,
  amount: number,
): { year: number; month: number } {
  const shifted = new Date(Date.UTC(year, month + amount, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/**
 * Mirror EventKit's one-year lookahead as local civil days. The end day stays
 * exclusive because the native query stops at the same local time next year.
 */
export function calendarQueryWindow(start: Date): CalendarQueryWindow {
  // The native query begins now; only the following local day has full coverage.
  const firstFullyQueriedDay = new Date(start);
  firstFullyQueriedDay.setDate(firstFullyQueriedDay.getDate() + 1);
  const year = start.getFullYear() + 1;
  const month = start.getMonth();
  const day = start.getDate();
  const end = new Date(start);
  end.setDate(1);
  end.setFullYear(year, month, 1);
  end.setDate(Math.min(day, new Date(year, month + 1, 0).getDate()));
  return {
    startDay: calendarDateKey(
      firstFullyQueriedDay.getFullYear(),
      firstFullyQueriedDay.getMonth(),
      firstFullyQueriedDay.getDate(),
    ),
    endDay: calendarDateKey(end.getFullYear(), end.getMonth(), end.getDate()),
  };
}

export function formatCalendarDate(dateKey: string): string {
  const date = dateFromKey(dateKey);
  if (!date) return dateKey;
  return CALENDAR_DATE_FORMATTER.format(date);
}

export function formatCalendarMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 1));
  return new Intl.DateTimeFormat('ko-KR', {
    calendar: 'gregory',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(date);
}

export function calendarWeekdays(): string[] {
  const firstSunday = Date.UTC(2023, 0, 1);
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    calendar: 'gregory',
    timeZone: 'UTC',
    weekday: 'short',
  });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(firstSunday + index * DAY_MILLISECONDS)),
  );
}
