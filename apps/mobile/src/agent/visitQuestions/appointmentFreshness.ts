import { compareTimestamps } from '@orot/domain';
import type { Appointment } from '@orot/domain';

/** A reviewed list can only replace questions for the same upcoming calendar visit. */
export function isUpcomingConfirmedCalendarAppointment(
  appointment: Appointment,
  now: string,
): boolean {
  return (
    (appointment.status === 'scheduled' ||
      appointment.status === 'rescheduled') &&
    Boolean(appointment.calendarEventIdentifier) &&
    appointment.calendarEventSnapshot !== undefined &&
    compareTimestamps(appointment.effectiveAt, now) >= 0
  );
}
