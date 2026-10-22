import type { Appointment } from '@orot/storage';
import { formatDateTime, formatTime } from '../i18n';

/** Calendar appointments remain current until their known end; never invent a duration for manual entries. */
export function appointmentDisplayUntil(appointment: Appointment): number {
  return Date.parse(appointment.endsAt ?? appointment.effectiveAt);
}

export function selectNextAppointment(
  appointments: readonly Appointment[],
  now: number,
): Appointment | null {
  return (
    appointments
      .filter(
        appointment =>
          (appointment.status === 'scheduled' ||
            appointment.status === 'rescheduled') &&
          appointmentDisplayUntil(appointment) > now,
      )
      .sort(
        (left, right) =>
          Date.parse(left.effectiveAt) - Date.parse(right.effectiveAt),
      )[0] ?? null
  );
}

/** A cross-midnight visit needs both local dates; same-day visits can abbreviate the end. */
export function appointmentTimeLabel(appointment: Appointment): string {
  const start = new Date(appointment.effectiveAt);
  if (!appointment.endsAt) return formatDateTime(start);
  const end = new Date(appointment.endsAt);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  return `${formatDateTime(start)} – ${sameDay ? formatTime(end) : formatDateTime(end)}`;
}
