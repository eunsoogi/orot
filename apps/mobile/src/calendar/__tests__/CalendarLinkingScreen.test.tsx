import { AppState } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import { calendarDateKey } from '../calendarMonth';
import type { CalendarBridge, CalendarEvent } from '../types';

function event(
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
    confirmCalendarEvent: jest.fn(async () => appointmentFor(event('saved'))),
    reconfirmCalendarEvent: jest.fn(async () => appointmentFor(event('saved'))),
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

describe('Calendar linking screen', () => {
  it('requests Calendar access only after the user starts linking and saves only the confirmed event', async () => {
    const selected = event('selected-event');
    const unrelated = event('unrelated-event', '2035-06-03T00:00:00.000Z');
    const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [unrelated, selected],
    }));
    const calendar = bridge({ requestAccessAndListUpcomingEvents });
    const appointments = repository(async () => []);
    await render(
      <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
    );

    expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('calendar-connect'));
    expect(
      await screen.findByTestId('calendar-candidate-selected-event'),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('calendar-candidate-selected-event'),
    );

    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(screen.getByTestId('calendar-selection')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));

    expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(selected);
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalledWith(
      unrelated,
    );
    expect(
      await screen.findByText('다음 외래 방문을 저장했어요.'),
    ).toBeTruthy();
  });

  it('does not show the empty candidate state when a saved next visit is reloaded', async () => {
    const current = appointmentFor(event('saved-event'));
    const appointments = repository(async () => [current]);
    const calendar = bridge({
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: event('saved-event'),
      })),
    });

    await render(
      <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
    );

    expect(await screen.findByTestId('calendar-next-visit')).toBeTruthy();
    expect(screen.queryByTestId('calendar-empty')).toBeNull();
  });

  it('describes empty upcoming-event results without asserting a date is clear', async () => {
    const calendar = bridge({
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'fullAccess' as const,
        events: [],
      })),
    });
    const appointments = repository(async () => []);

    await render(
      <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
    );
    await fireEvent.press(screen.getByTestId('calendar-connect'));

    expect(await screen.findByTestId('calendar-empty')).toHaveTextContent(
      '조회된 일정이 없어요.',
    );
    expect(screen.getByTestId('calendar-empty-query-note')).toBeTruthy();
    expect(screen.queryByTestId('calendar-outside-query')).toBeNull();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = calendarDateKey(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate(),
    );
    await fireEvent.press(screen.getByTestId(`calendar-day-${tomorrowKey}`));
    expect(await screen.findByTestId('calendar-empty')).toBeTruthy();
  });

  it('shows a denied permission state without saving or guessing from events', async () => {
    const calendar = bridge({
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'denied' as const,
        events: [],
      })),
    });
    const appointments = repository(async () => []);
    await render(
      <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
    );

    await fireEvent.press(screen.getByTestId('calendar-connect'));

    expect(
      await screen.findByTestId('calendar-access-state'),
    ).toHaveTextContent(/캘린더 접근을 허용하지 않았어요\./u);
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
  });

  it('asks the user to reconfirm a changed event before updating the appointment', async () => {
    const original = event('linked-event');
    const changed = event('linked-event', '2035-06-04T00:00:00.000Z');
    const current = appointmentFor(original);
    const list = jest.fn(async () => [current]);
    const appointments = repository(list);
    const calendar = bridge({
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: changed,
      })),
    });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );
      expect(await screen.findByTestId('calendar-change-warning')).toBeTruthy();
      expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByTestId('calendar-review-change'));
      expect(screen.getByTestId('calendar-selection')).toBeTruthy();
      expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));

      expect(appointments.reconfirmCalendarEvent).toHaveBeenCalledWith(
        current.id,
        changed,
      );
    } finally {
      appStateSpy.mockRestore();
    }
  });

  it('asks the user to choose again when the linked event is missing', async () => {
    const current = appointmentFor(event('deleted-event'));
    const appointments = repository(async () => [current]);
    const calendar = bridge({
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: null,
      })),
    });
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    try {
      await render(
        <CalendarLinkingScreen repository={appointments} bridge={calendar} />,
      );
      expect(
        await screen.findByTestId('calendar-missing-warning'),
      ).toBeTruthy();
      expect(appointments.cancel).not.toHaveBeenCalled();
      expect(appointments.reconfirmCalendarEvent).not.toHaveBeenCalled();
    } finally {
      appStateSpy.mockRestore();
    }
  });
});
