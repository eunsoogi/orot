import { formatDate, formatDateTime, formatTime, t } from '../i18n';
import type { CalendarEvent } from './types';

function calendarTimeZone(event: CalendarEvent): string {
  return (
    event.calendarEventSnapshot.timeZoneIdentifier ??
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
}
function formatDateInZone(value: Date, timeZone: string): string {
  return formatDate(value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
}

function parseFloatingDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const timestamp = `${value}Z`;
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === timestamp
    ? parsed
    : null;
}

function eventDisplayTimes(event: CalendarEvent) {
  const isFloating = event.calendarEventSnapshot.timeZoneIdentifier === null;
  const floatingStart = isFloating
    ? parseFloatingDateTime(event.calendarEventSnapshot.floatingStartAt)
    : null;
  const floatingEnd = isFloating
    ? parseFloatingDateTime(event.calendarEventSnapshot.floatingEndAt)
    : null;
  const displayFloatingComponents =
    floatingStart !== null && floatingEnd !== null;
  const timeZone = displayFloatingComponents ? 'UTC' : calendarTimeZone(event);
  const start = floatingStart ?? new Date(event.effectiveAt);
  const end = floatingEnd ?? new Date(event.endsAt);
  return { start, end, timeZone };
}

/** Short display only. Detail keeps the full dates and source time zone. */
export function formatCalendarEventCompactRange(event: CalendarEvent): string {
  const { start, end, timeZone } = eventDisplayTimes(event);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    return t('appointments.errors.invalidTime');
  const date = (value: Date) =>
    formatDate(value, { month: 'long', day: 'numeric', timeZone });
  const startDate = date(start);
  if (event.calendarEventSnapshot.isAllDay) {
    const lastDate = date(new Date(end.getTime() - 1));
    return `${lastDate === startDate ? startDate : `${startDate}–${lastDate}`} · ${t('calendar.allDay')}`;
  }
  const endDate = date(end);
  return `${startDate} ${formatTime(start, timeZone)}–${endDate !== startDate ? endDate + ' ' : ''}${formatTime(end, timeZone)}`;
}

/** Only omit the date when the selected heading supplies that exact civil day. */
export function formatCalendarAgendaTime(
  event: CalendarEvent,
  dateKey: string,
): string {
  const { start, end, timeZone } = eventDisplayTimes(event);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return formatCalendarEventRange(event);
  }
  const heading = formatDateInZone(new Date(`${dateKey}T00:00:00.000Z`), 'UTC');
  const allDay = event.calendarEventSnapshot.isAllDay;
  const last = allDay ? new Date(end.getTime() - 1) : end;
  if (
    formatDateInZone(start, timeZone) !== heading ||
    formatDateInZone(last, timeZone) !== heading
  ) {
    return formatCalendarEventRange(event);
  }
  if (allDay) return t('calendar.allDay');
  const time = `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`;
  const sourceZone = event.calendarEventSnapshot.timeZoneIdentifier;
  return sourceZone &&
    sourceZone !== Intl.DateTimeFormat().resolvedOptions().timeZone
    ? `${time} · ${sourceZone}`
    : time;
}

export function formatCalendarEventRange(event: CalendarEvent): string {
  const { start, end, timeZone } = eventDisplayTimes(event);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return t('appointments.errors.invalidTime');
  }

  if (event.calendarEventSnapshot.isAllDay) {
    const lastIncludedInstant = new Date(end.getTime() - 1);
    const startDate = formatDateInZone(start, timeZone);
    const endDate = formatDateInZone(lastIncludedInstant, timeZone);
    const dateRange =
      startDate === endDate ? startDate : `${startDate}–${endDate}`;
    return `${dateRange} · ${t('calendar.allDay')}`;
  }

  const startDateTime = formatDateTime(start, timeZone);
  const endTime =
    formatDateInZone(start, timeZone) === formatDateInZone(end, timeZone)
      ? formatTime(end, timeZone)
      : formatDateTime(end, timeZone);
  const timeZoneLabel =
    event.calendarEventSnapshot.timeZoneIdentifier ??
    t('appointments.localTime');
  return `${startDateTime}–${endTime} · ${timeZoneLabel}`;
}

// The month heading supplies the year; the agenda heading supplies the selected weekday.
const CALENDAR_AGENDA_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  calendar: 'gregory',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  weekday: 'long',
});

export function formatCalendarAgendaDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? CALENDAR_AGENDA_DATE_FORMATTER.format(date)
    : dateKey;
}
