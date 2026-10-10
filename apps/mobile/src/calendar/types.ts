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
  requestEventAccess?: () => Promise<CalendarAccessState>;
  listUpcomingEvents?: () => Promise<UpcomingCalendarEvents>;
  requestAccessAndListUpcomingEvents(): Promise<UpcomingCalendarEvents>;
  findEvent(
    calendarEventIdentifier: string,
    occurrenceDate: string | null,
    floatingOccurrenceAt: string | null,
  ): Promise<CalendarEventLookup>;
  addEventStoreListener(listener: () => void): { remove: () => void };
}

/** Required split consent/query surface for selected-provider imports. */
export interface EventKitImportBridge {
  requestEventAccess(): Promise<CalendarAccessState>;
  listUpcomingEvents(): Promise<UpcomingCalendarEvents>;
}

export type EventKitCalendarBridge = CalendarBridge & EventKitImportBridge;
