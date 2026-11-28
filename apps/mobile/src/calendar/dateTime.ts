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

/** Start time in the event's source zone, including floating and all-day events. */
export function formatCalendarEventStart(event: CalendarEvent): string {
  const { start, timeZone } = eventDisplayTimes(event);
  if (!Number.isFinite(start.getTime()))
    return t('appointments.errors.invalidTime');
  return event.calendarEventSnapshot.isAllDay
    ? t('calendar.allDay')
    : formatTime(start, timeZone);
}

/** The summary can omit the label without changing the source time conversion. */
export function formatCalendarEventRange(
  event: CalendarEvent,
  options?: { hideTimeZoneLabel?: boolean },
): string {
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
  return `${startDateTime}–${endTime}${options?.hideTimeZoneLabel ? '' : ` · ${timeZoneLabel}`}`;
}
