import type { CalendarAppointmentInput } from '@orot/storage';

export type CalendarEvent = CalendarAppointmentInput;

/** Calendar confirmation is a plan status, never evidence of attendance. */
export type CalendarRangeEvent = CalendarEvent & {
  calendarStatus?: 'none' | 'confirmed' | 'tentative' | 'canceled';
};

export type CalendarAccessState =
  'fullAccess' | 'writeOnly' | 'notDetermined' | 'denied' | 'restricted';

/** Native query covers starts in this interval, not the user's entire Calendar history. */
export interface CalendarQueryCoverage {
  readonly fromInclusive: string;
  readonly toExclusive: string;
  readonly horizonYears: 1;
  readonly resultLimit: null;
  readonly complete: boolean;
  readonly omittedEventCount: number;
}

export interface UpcomingCalendarEvents {
  access: CalendarAccessState;
  events: CalendarEvent[];
  /** Older injected adapters may omit coverage; absence never proves completeness. */
  query?: CalendarQueryCoverage;
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

/** Read-only live-calendar boundary; missing/incomplete coverage never means no events. */
export interface CalendarRangeEvents {
  access: CalendarAccessState;
  events: CalendarRangeEvent[];
  query?: Omit<CalendarQueryCoverage, 'horizonYears'>;
}

export interface CalendarRangeBridge {
  listEventsInRange(
    fromInclusive: string,
    toExclusive: string,
  ): Promise<CalendarRangeEvents>;
  addEventStoreListener(listener: () => void): { remove(): void };
}
