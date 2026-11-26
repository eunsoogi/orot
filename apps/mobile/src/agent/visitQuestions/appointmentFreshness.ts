import {
  AppointmentSchema,
  compareTimestamps,
  TimestampSchema,
} from '@orot/domain';
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

/** Canonical confirmation and exact lower bound for both explicit-ID and next-local-visit reads. */
export function checkedUpcomingCalendarAppointment(
  value: unknown,
  now: string,
  expectedId?: string,
) {
  const parsed = AppointmentSchema.safeParse(value);
  if (!parsed.success) return { kind: 'invalid' } as const;
  const appointment = parsed.data;
  if (
    !TimestampSchema.safeParse(now).success ||
    (expectedId !== undefined && appointment.id !== expectedId) ||
    appointment.provenance.origin !== 'user_reported' ||
    !isUpcomingConfirmedCalendarAppointment(appointment, now)
  )
    return { kind: 'unavailable' } as const;
  return { kind: 'available', appointment } as const;
}
