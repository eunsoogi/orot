import type { Appointment } from '@orot/storage';
import { appointmentStartTime } from '../calendar/appointmentTime';

/** Explicit opt-in chooses one visit and an elapsed duration before its start. */
export interface AppointmentReminderSelection {
  readonly appointmentId: string;
  readonly leadMinutes: 60 | 1440;
}

/** The OS receives only an opaque local identity and times, never clinical text. */
export interface AppointmentReminderPlan extends AppointmentReminderSelection {
  readonly appointmentStartAt: number;
  readonly fireAt: number;
  readonly floating: boolean;
  readonly timeKey: string;
}

export interface AppointmentReminderTarget {
  readonly appointmentId: string;
  readonly timeKey: string;
}

function floatingStart(appointment: Appointment): string | undefined {
  const snapshot = appointment.calendarEventSnapshot;
  return snapshot?.timeZoneIdentifier === null
    ? snapshot.floatingStartAt
    : undefined;
}

function appointmentTimeKey(appointment: Appointment): string {
  const floating = floatingStart(appointment);
  // A device time-zone change must not invalidate an unchanged floating visit.
  return floating
    ? `floating:${floating}`
    : `instant:${appointmentStartTime(appointment)}`;
}

function activeAppointment(appointment: Appointment): boolean {
  return (
    appointment.status === 'scheduled' || appointment.status === 'rescheduled'
  );
}

/**
 * Rebuild from the committed appointment rather than shifting an old request.
 * Calendar floating civil times use the existing resolver; zoned appointments
 * retain their absolute instant. Lead time is elapsed minutes, including DST.
 */
export function buildAppointmentReminder(
  appointments: readonly Appointment[],
  selection: AppointmentReminderSelection | null,
  now: number,
): AppointmentReminderPlan | null {
  if (
    !selection ||
    !Number.isFinite(now) ||
    ![60, 1440].includes(selection.leadMinutes)
  )
    return null;
  const appointment = appointments.find(
    candidate => candidate.id === selection.appointmentId,
  );
  if (!appointment || !activeAppointment(appointment)) return null;
  const appointmentStartAt = appointmentStartTime(appointment);
  const fireAt = appointmentStartAt - selection.leadMinutes * 60_000;
  // Missed reminders are removed, never converted into an immediate alert.
  if (!Number.isFinite(fireAt) || fireAt <= now) return null;
  return {
    appointmentId: appointment.id,
    leadMinutes: selection.leadMinutes,
    appointmentStartAt,
    fireAt,
    floating: Boolean(floatingStart(appointment)),
    timeKey: appointmentTimeKey(appointment),
  };
}

/** Reject malformed/stale taps instead of falling back to another upcoming visit. */
export function resolveAppointmentReminderTarget(
  value: unknown,
  appointments: readonly Appointment[],
  now: number,
): Appointment | null {
  if (!value || typeof value !== 'object' || !Number.isFinite(now))
    return null;
  const target = value as Partial<AppointmentReminderTarget>;
  if (
    typeof target.appointmentId !== 'string' ||
    typeof target.timeKey !== 'string'
  )
    return null;
  const appointment = appointments.find(
    candidate => candidate.id === target.appointmentId,
  );
  return appointment &&
    activeAppointment(appointment) &&
    appointmentStartTime(appointment) > now &&
    appointmentTimeKey(appointment) === target.timeKey
    ? appointment
    : null;
}
