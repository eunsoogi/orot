import { formatDate, formatDateTime, formatTime, t } from '../i18n';
import type { CalendarEvent } from './types';

function calendarTimeZone(event: CalendarEvent): string {
  return event.calendarEventSnapshot.timeZoneIdentifier ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function formatDateInZone(value: Date, timeZone: string): string {
  return formatDate(value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
}

export function formatCalendarEventRange(event: CalendarEvent): string {
  const timeZone = calendarTimeZone(event);
  const start = new Date(event.effectiveAt);
  const end = new Date(event.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return t('appointments.errors.invalidTime');
  }

  if (event.calendarEventSnapshot.isAllDay) {
    const lastIncludedInstant = new Date(end.getTime() - 1);
    const startDate = formatDateInZone(start, timeZone);
    const endDate = formatDateInZone(lastIncludedInstant, timeZone);
    const dateRange = startDate === endDate ? startDate : `${startDate}–${endDate}`;
    return `${dateRange} · ${t('calendar.allDay')}`;
  }

  const startDateTime = formatDateTime(start, timeZone);
  const endTime = formatTime(end, timeZone);
  const timeZoneLabel = event.calendarEventSnapshot.timeZoneIdentifier ??
    t('appointments.localTime');
  return `${startDateTime}–${endTime} · ${timeZoneLabel}`;
}
