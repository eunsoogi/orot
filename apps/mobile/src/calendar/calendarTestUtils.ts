import type { Appointment, AppointmentRepository } from '@orot/storage';
import type { CalendarBridge, CalendarEvent } from './types';

/** Shared synthetic events and repositories for Calendar linking tests. */
export function event(identifier: string, effectiveAt: string): CalendarEvent {
  return {
    calendarEventIdentifier: identifier,
    effectiveAt,
    endsAt: new Date(new Date(effectiveAt).getTime() + 3_600_000).toISOString(),
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

export function repository(list: () => Promise<Appointment[]>) {
  return {
    list: jest.fn(list),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(async () =>
      appointmentFor(event('saved', '2035-06-02T00:00:00.000Z')),
    ),
    reconfirmCalendarEvent: jest.fn(async () =>
      appointmentFor(event('saved', '2035-06-02T00:00:00.000Z')),
    ),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

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

/** Encode device local components without an offset, as floating events require. */
export function floatingDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(value => value.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}
