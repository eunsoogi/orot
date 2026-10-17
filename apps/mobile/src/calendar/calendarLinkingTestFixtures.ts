import type { Appointment, AppointmentRepository } from '@orot/storage';
import type { CalendarAutoSyncState } from '../calendarAutoSync';
import type { CalendarBridge, CalendarEvent } from '../types';

/** Stable fixtures keep screen tests focused on sync and confirmation behavior without native EventKit access. */
export function event(
  identifier: string,
  effectiveAt = '2035-06-02T00:00:00.000Z',
): CalendarEvent {
  const endsAt = new Date(
    new Date(effectiveAt).getTime() + 60 * 60 * 1000,
  ).toISOString();
  return {
    calendarEventIdentifier: identifier,
    effectiveAt,
    endsAt,
    calendarEventSnapshot: {
      title: identifier,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

/** Builds the persisted appointment shape used by linked-event reload tests. */
export function appointmentFor(selected: CalendarEvent): Appointment {
  return {
    id: 'calendar-appointment-1',
    effectiveAt: selected.effectiveAt,
    endsAt: selected.endsAt,
    recordedAt: '2035-01-01T00:00:00.000Z',
    ingestedAt: '2035-01-01T00:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
    calendarEventIdentifier: selected.calendarEventIdentifier,
    calendarEventSnapshot: selected.calendarEventSnapshot,
  };
}

/** Keeps persistence spies configurable while defaulting unused writes to no-ops. */
export function repository(list: () => Promise<Appointment[]>) {
  return {
    list: jest.fn(list),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(async () => appointmentFor(event('saved'))),
    reconfirmCalendarEvent: jest.fn(async () => appointmentFor(event('saved'))),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

/** Supplies deterministic EventKit responses that each test can override. */
export function bridge(
  overrides: Partial<CalendarBridge> = {},
): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    ...overrides,
  };
}

/** Models a startup sync snapshot so tests can assert that the screen does not request access again. */
export function syncedCalendar(
  events: readonly CalendarEvent[],
  access: CalendarAutoSyncState['access'] = 'fullAccess',
): CalendarAutoSyncState {
  return {
    access,
    events,
    query: null,
    loading: false,
    error: false,
    updatedAt: '2035-06-01T00:00:00.000Z',
  };
}
