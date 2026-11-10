import { AppointmentSchema } from '@orot/domain';
import { isUpcomingConfirmedCalendarAppointment } from './appointmentFreshness';
import type {
  VisitQuestionEvidenceRepository,
  VisitQuestionQueryPort,
} from './evidenceRevalidation';

/** Revalidate the selected appointment by ID; never replace it with a different upcoming visit. */
export function selectedVisitQuery(
  query: VisitQuestionQueryPort,
  repository: VisitQuestionEvidenceRepository,
  appointmentId?: string,
): VisitQuestionQueryPort {
  if (appointmentId === undefined) return query;
  return {
    searchMemory: (...args) => query.searchMemory(...args),
    async queryNextConfirmedCalendarAppointment(now) {
      const parsed = AppointmentSchema.safeParse(
        appointmentId.trim()
          ? await repository.get('appointment', appointmentId)
          : null,
      );
      if (
        !parsed.success ||
        parsed.data.id !== appointmentId ||
        parsed.data.provenance.origin !== 'user_reported' ||
        !isUpcomingConfirmedCalendarAppointment(parsed.data, now)
      )
        return {
          status: 'no_confirmed_upcoming_calendar_appointment',
          appointment: null,
        };
      return { status: 'available', appointment: parsed.data };
    },
  };
}
