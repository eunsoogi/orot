import type { Appointment } from '@orot/storage';
import { formatDateTime, formatTime } from '../i18n';

/** Calendar appointments remain current until their known end; never invent a duration for manual entries. */
export function appointmentDisplayUntil(appointment: Appointment): number {
  return Date.parse(appointment.endsAt ?? appointment.effectiveAt);
}

/** Uses one exclusive instant boundary for Home, appointment lists, and route eligibility. */
export function isEligibleNextVisit(
  appointment: Appointment,
  now: number,
): boolean {
  return (
    (appointment.status === 'scheduled' ||
      appointment.status === 'rescheduled') &&
    appointmentDisplayUntil(appointment) > now
  );
}

/** Equal start instants stay separate; stable IDs make the singular Home choice deterministic. */
function compareNextVisits(left: Appointment, right: Appointment): number {
  const leftStart = Date.parse(left.effectiveAt);
  const rightStart = Date.parse(right.effectiveAt);
  if (leftStart < rightStart) return -1;
  if (leftStart > rightStart) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function selectNextAppointment(
  appointments: readonly Appointment[],
  now: number,
): Appointment | null {
  return (
    appointments
      .filter(appointment => isEligibleNextVisit(appointment, now))
      .sort(compareNextVisits)[0] ?? null
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
