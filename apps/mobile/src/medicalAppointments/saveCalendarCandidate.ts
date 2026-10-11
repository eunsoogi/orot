import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge } from '../calendar/types';
import { calendarEventsMatch } from './calendarEvidence';
import type { CandidateReview } from './classificationWorkflow';

/** Ambiguous relevance or confidence never becomes an automatic appointment write. */
export function isConfidentMedical(candidate: CandidateReview): boolean {
  return (
    candidate.status === 'classified' &&
    candidate.classification === 'medical' &&
    candidate.uncertainty === 'low'
  );
}

/** Revalidates occurrence identity before a write and keeps repeat imports idempotent. */
export async function saveCalendarCandidate(
  candidate: CandidateReview,
  repository: AppointmentRepository,
  bridge: CalendarBridge,
  signal?: AbortSignal,
): Promise<'saved' | 'stale' | 'cancelled' | 'preserved'> {
  if (signal?.aborted) return 'cancelled';
  const existingAppointments = await repository.list();
  const linked = existingAppointments.find(
    appointment =>
      appointment.calendarEventIdentifier ===
        candidate.event.calendarEventIdentifier &&
      appointment.calendarEventSnapshot?.occurrenceDate ===
        candidate.event.calendarEventSnapshot.occurrenceDate &&
      (appointment.calendarEventSnapshot?.floatingOccurrenceAt ?? null) ===
        (candidate.event.calendarEventSnapshot.floatingOccurrenceAt ?? null),
  );
  if (signal?.aborted) return 'cancelled';
  // An unchanged calendar occurrence must not undo a user's cancellation or completion.
  if (
    linked &&
    linked.status !== 'scheduled' &&
    linked.status !== 'rescheduled'
  )
    return 'preserved';
  // Permissions and the full snapshot must still match when classification finishes.
  const current = await bridge.findEvent(
    candidate.event.calendarEventIdentifier,
    candidate.event.calendarEventSnapshot.occurrenceDate,
    candidate.event.calendarEventSnapshot.floatingOccurrenceAt ?? null,
  );
  if (signal?.aborted) return 'cancelled';
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
