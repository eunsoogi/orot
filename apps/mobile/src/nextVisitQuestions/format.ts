import type { Appointment } from '@orot/domain';

export interface FormattedAppointmentTime {
  readonly label: string;
  readonly timeZoneNote: 'calendar' | 'device' | 'calendar_unreadable';
}

/** Uses the Calendar snapshot's time zone when present; device time is labeled as a fallback. */
export function formatNextVisitTime(
  appointment: Appointment,
): FormattedAppointmentTime | null {
  const instant = new Date(appointment.effectiveAt);
  if (!Number.isFinite(instant.getTime())) return null;

  const calendarTimeZone =
    appointment.calendarEventSnapshot?.timeZoneIdentifier?.trim();
  if (calendarTimeZone) {
    try {
      return {
        label: formatInZone(instant, calendarTimeZone),
        timeZoneNote: 'calendar',
      };
    } catch {
      // An invalid snapshot zone must not silently look like the Calendar's local time.
      return {
        label: formatInZone(instant),
        timeZoneNote: 'calendar_unreadable',
      };
    }
  }

  return { label: formatInZone(instant), timeZoneNote: 'device' };
}

function formatInZone(value: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}
