import type { CalendarAppointmentInput } from '@orot/storage';

export type CalendarEvent = CalendarAppointmentInput;

export type CalendarAccessState =
  'fullAccess' | 'writeOnly' | 'notDetermined' | 'denied' | 'restricted';

export interface UpcomingCalendarEvents {
  access: CalendarAccessState;
  events: CalendarEvent[];
}

export interface CalendarEventLookup {
  access: CalendarAccessState;
  event: CalendarEvent | null;
}

export interface CalendarBridge {
  requestAccessAndListUpcomingEvents(): Promise<UpcomingCalendarEvents>;
  findEvent(
    calendarEventIdentifier: string,
    occurrenceDate: string | null,
    floatingOccurrenceAt: string | null,
  ): Promise<CalendarEventLookup>;
  addEventStoreListener(listener: () => void): { remove: () => void };
}

/** Separates one explicit permission request from later read-only event queries. */
export interface CalendarImportBridge {
  requestAccessIfNeeded(): Promise<CalendarAccessState>;
  listUpcomingEvents(): Promise<UpcomingCalendarEvents>;
}
