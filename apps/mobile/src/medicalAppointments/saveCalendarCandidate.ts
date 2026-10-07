import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge } from '../calendar/types';
import { calendarEventsMatch } from './calendarEvidence';
import type { CandidateReview } from './classificationWorkflow';

/** Revalidates the selected occurrence and snapshot at the explicit save boundary. */
export async function saveCalendarCandidate(
  candidate: CandidateReview,
  repository: AppointmentRepository,
  bridge: CalendarBridge,
): Promise<'saved' | 'stale'> {
  const existingAppointments = await repository.list();
  const linked = existingAppointments.find(
    appointment =>
      (appointment.status === 'scheduled' ||
        appointment.status === 'rescheduled') &&
      appointment.calendarEventIdentifier ===
        candidate.event.calendarEventIdentifier &&
      appointment.calendarEventSnapshot?.occurrenceDate ===
        candidate.event.calendarEventSnapshot.occurrenceDate &&
      (appointment.calendarEventSnapshot?.floatingOccurrenceAt ?? null) ===
        (candidate.event.calendarEventSnapshot.floatingOccurrenceAt ?? null),
  );
  // Permission, occurrence identity, and the full snapshot are checked after the user's save action.
  const current = await bridge.findEvent(
    candidate.event.calendarEventIdentifier,
    candidate.event.calendarEventSnapshot.occurrenceDate,
    candidate.event.calendarEventSnapshot.floatingOccurrenceAt ?? null,
  );
  if (
    current.access !== 'fullAccess' ||
    !current.event ||
    !calendarEventsMatch(candidate.event, current.event)
  ) {
    return 'stale';
  }
  if (linked) {
    await repository.reconfirmCalendarEvent(linked.id, current.event);
  } else {
    await repository.confirmCalendarEvent(current.event);
  }
  return 'saved';
}
