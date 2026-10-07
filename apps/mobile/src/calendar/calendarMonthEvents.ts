import type { Appointment } from '@orot/storage';
import { calendarEventMatchesAppointment } from './calendarSnapshot';
import type { CalendarEvent } from './types';

export interface CalendarMonthDisplayEvent {
  event: CalendarEvent;
  isNextVisit: boolean;
  canSelect: boolean;
  rowKey: string;
}

function occurrenceKey(event: CalendarEvent): string {
  const snapshot = event.calendarEventSnapshot;
  return `${event.calendarEventIdentifier}:${snapshot.floatingOccurrenceAt ?? snapshot.occurrenceDate ?? event.effectiveAt}`;
}

export function eventFromAppointment(
  appointment: Appointment | null,
): CalendarEvent | null {
  if (
    !appointment?.calendarEventIdentifier ||
    !appointment.calendarEventSnapshot
  ) {
    return null;
  }
  return {
    calendarEventIdentifier: appointment.calendarEventIdentifier,
    effectiveAt: appointment.effectiveAt,
    endsAt: appointment.endsAt ?? appointment.effectiveAt,
    calendarEventSnapshot: appointment.calendarEventSnapshot,
  };
}

/** Keep the saved snapshot visible until one live candidate exactly matches it. */
export function projectCalendarMonthEvents(
  events: CalendarEvent[],
  linkedAppointment: Appointment | null,
): CalendarMonthDisplayEvent[] {
  const linkedEvent = eventFromAppointment(linkedAppointment);
  const confirmedCandidate = linkedAppointment
    ? events.find(event =>
        calendarEventMatchesAppointment(event, linkedAppointment),
      )
    : undefined;
  const candidates = events.map(event => ({
    event,
    isNextVisit: event === confirmedCandidate,
    canSelect: true,
    rowKey: `candidate:${occurrenceKey(event)}`,
  }));
  if (linkedEvent && !confirmedCandidate) {
    candidates.push({
      event: linkedEvent,
      isNextVisit: true,
      canSelect: false,
      rowKey: `confirmed:${occurrenceKey(linkedEvent)}`,
    });
  }
  return candidates.sort(
    (left, right) =>
      new Date(left.event.effectiveAt).getTime() -
      new Date(right.event.effectiveAt).getTime(),
  );
}
