import { AppState } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import type { CalendarBridge, CalendarEvent } from '../types';

function event(identifier: string, effectiveAt: string): CalendarEvent {
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

function appointmentFor(selected: CalendarEvent): Appointment {
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

function repository(list: () => Promise<Appointment[]>) {
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

function bridge(overrides: Partial<CalendarBridge> = {}): CalendarBridge {
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

function floatingDateTime(date: Date): string {
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

describe('Calendar linked event revalidation', () => {
  it('rechecks a linked event whose saved time passed while the app was closed', async () => {
    const current = appointmentFor(
      event(
        'rescheduled-while-closed',
        new Date(Date.now() - 86_400_000).toISOString(),
      ),
    );
    const movedEvent = event(
      'rescheduled-while-closed',
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const appointments = repository(async () => [current]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: movedEvent,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );

      expect(await screen.findByTestId('calendar-change-warning')).toBeTruthy();
      expect(findEvent).toHaveBeenCalledWith(
        'rescheduled-while-closed',
        null,
        null,
      );
      expect(screen.queryByTestId('calendar-next-visit')).toBeNull();
      expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    } finally {
      appStateSpy.mockRestore();
    }
  });

  it('keeps a floating visit upcoming and unchanged when its absolute time changes with the device zone', async () => {
    const newLocalStart = new Date(Date.now() + 86_400_000);
    const newLocalEnd = new Date(newLocalStart.getTime() + 3_600_000);
    const priorAbsoluteStart = new Date(Date.now() - 86_400_000).toISOString();
    const priorEvent = event('floating-visit', priorAbsoluteStart);
    const stored = {
      ...priorEvent,
      calendarEventSnapshot: {
        ...priorEvent.calendarEventSnapshot,
        timeZoneIdentifier: null,
        floatingStartAt: floatingDateTime(newLocalStart),
        floatingEndAt: floatingDateTime(newLocalEnd),
        floatingOccurrenceAt: null,
      },
    } as CalendarEvent;
    const currentEvent = {
      ...stored,
      effectiveAt: newLocalStart.toISOString(),
      endsAt: newLocalEnd.toISOString(),
    };
    const appointments = repository(async () => [appointmentFor(stored)]);
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: currentEvent,
    }));
    const calendar = bridge({ findEvent });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );

      expect(await screen.findByTestId('calendar-next-visit')).toBeTruthy();
      expect(screen.getByTestId('calendar-next-visit-time')).toHaveTextContent(
        /현지 시간/u,
      );
      expect(findEvent).toHaveBeenCalledWith('floating-visit', null, null);
      expect(screen.queryByTestId('calendar-change-warning')).toBeNull();
    } finally {
      appStateSpy.mockRestore();
    }
  });
});
