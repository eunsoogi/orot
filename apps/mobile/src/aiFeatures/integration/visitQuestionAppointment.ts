import { AppointmentSchema } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import { selectedVisitQuery } from '../../agent/visitQuestions/selectedVisitQuery';

/** A named target is revalidated by identity and never replaced by another upcoming visit. */
export async function loadVisitQuestionAppointment(
  now: string,
  appointmentId?: string,
): Promise<Appointment | null> {
  const { openLocalRecordQueryService } =
    await import('../../agent/localRecordQuery');
  const service = await openLocalRecordQueryService();
  const query =
    appointmentId === undefined
      ? service
      : selectedVisitQuery(
          service,
          await (
            await import('../../storage/secureDatabase')
          ).openLocalStorage(),
          appointmentId,
        );
  const result = await query.queryNextConfirmedCalendarAppointment(now);
  if (
    result.status === 'no_confirmed_upcoming_calendar_appointment' ||
    !result.appointment
  )
    return null;
  const appointment = AppointmentSchema.safeParse(result.appointment);
  if (!appointment.success) throw new Error('The next appointment is invalid.');
  return appointment.data;
}
