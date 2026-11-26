import { checkedUpcomingCalendarAppointment } from '../../agent/visitQuestions/appointmentFreshness';
import type { Appointment } from '@orot/domain';
import { selectedVisitQuery } from '../../agent/visitQuestions/selectedVisitQuery';

/** A named target is revalidated by identity and never replaced by another upcoming visit. */
export async function loadVisitQuestionAppointment(
  now: string,
  appointmentId?: string,
): Promise<Appointment | null> {
  // Load the encrypted-store adapter only when a visit request starts.
  const { openLocalRecordQueryService } =
    require('../../agent/localRecordQuery') as typeof import('../../agent/localRecordQuery');
  const service = await openLocalRecordQueryService();
  const query =
    appointmentId === undefined
      ? service
      : selectedVisitQuery(
          service,
          await (
            require('../../storage/secureDatabase') as typeof import('../../storage/secureDatabase')
          ).openLocalStorage(),
          appointmentId,
        );
  const result = await query.queryNextConfirmedCalendarAppointment(now);
  if (
    result.status === 'no_confirmed_upcoming_calendar_appointment' ||
    !result.appointment
  )
    return null;
  const checked = checkedUpcomingCalendarAppointment(
    result.appointment,
    now,
    appointmentId,
  );
  if (checked.kind === 'invalid')
    throw new Error('The next appointment is invalid.');
  return checked.kind === 'available' ? checked.appointment : null;
}
