import { checkedUpcomingCalendarAppointment } from './appointmentFreshness';
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
      const checked = checkedUpcomingCalendarAppointment(
        appointmentId.trim()
          ? await repository.get('appointment', appointmentId)
          : null,
        now,
        appointmentId,
      );
      if (checked.kind !== 'available')
        return {
          status: 'no_confirmed_upcoming_calendar_appointment',
          appointment: null,
        };
      return { status: 'available', appointment: checked.appointment };
    },
  };
}
