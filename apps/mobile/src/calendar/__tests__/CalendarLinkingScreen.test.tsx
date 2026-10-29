import { AppState } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import {
  appointmentFor,
  bridge,
  event,
  repository,
  syncedCalendar,
} from '../calendarLinkingTestFixtures';
import { calendarDateKey } from '../calendarMonth';

describe('Calendar linking screen', () => {
  it('uses the schedule-first hierarchy and keeps permission detail out of the calendar view', async () => {
    await render(
      <CalendarLinkingScreen
        repository={repository(async () => [])}
        bridge={bridge()}
        calendarSync={syncedCalendar([])}
        heading="일정"
        onOpenAppointments={jest.fn()}
        onOpenMedicalAppointments={jest.fn()}
      />,
    );

    expect(screen.getByTestId('calendar-title')).toHaveTextContent('일정');
    expect(screen.getByTestId('schedule-subtitle')).toHaveTextContent(
      '일정을 확인하고 진료를 준비해요.',
    );
    expect(screen.getByTestId('calendar-quick-actions')).toBeTruthy();
    expect(screen.getByTestId('calendar-month-view')).toBeTruthy();
    expect(
      screen.queryByText(
        'iOS는 일정을 읽을 때 캘린더 전체 접근(읽기 및 쓰기)을 요구해요. 오롯 앱은 선택한 일정 정보만 이 기기에 저장하고, 캘린더를 수정하거나 삭제하지 않아요.',
      ),
    ).toBeNull();
  });

  it('uses the automatically synced candidates and saves only the event the user confirms', async () => {
    const selected = event('selected-event');
    const unrelated = event('unrelated-event', '2035-06-03T00:00:00.000Z');
    const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [unrelated, selected],
    }));
    const calendar = bridge({
      requestAccessAndListUpcomingEvents,
      findEvent: jest.fn(async () => ({
        access: 'fullAccess' as const,
        event: selected,
      })),
    });
    let savedAppointments: ReturnType<typeof appointmentFor>[] = [];
    const appointments = repository(async () => savedAppointments);
    appointments.confirmCalendarEvent = jest.fn(async () => {
      const saved = appointmentFor(selected);
      savedAppointments = [saved];
      return saved;
    });
    await render(
      <CalendarLinkingScreen
        adaptiveScheduleLayout
        repository={appointments}
        bridge={calendar}
        calendarSync={syncedCalendar([unrelated, selected])}
      />,
    );

    expect(requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
    expect(screen.queryByTestId('calendar-connect')).toBeNull();
    expect(
      await screen.findByTestId('calendar-candidate-selected-event'),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('calendar-candidate-selected-event'),
    );

    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalled();
    expect(screen.getByTestId('calendar-selection')).toBeTruthy();
    expect(
      screen.queryByTestId('schedule-adaptive-columns-secondary'),
    ).toBeNull();
    await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));

    expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(selected);
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalledWith(
      unrelated,
    );
    expect(
      await screen.findByText('다음 외래 방문을 저장했어요.'),
    ).toBeTruthy();
    expect(
      await screen.findByTestId('schedule-next-visit-summary'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('schedule-adaptive-columns-secondary'),
    ).toBeNull();
    expect(screen.getByTestId('schedule-next-visit-title')).toBeTruthy();
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
    expect(screen.queryByTestId('schedule-next-visit-summary')).toBeNull();
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
      <CalendarLinkingScreen
        repository={appointments}
        bridge={calendar}
        calendarSync={syncedCalendar([])}
      />,
    );

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
      <CalendarLinkingScreen
        repository={appointments}
        bridge={calendar}
        calendarSync={syncedCalendar([], 'denied')}
      />,
    );

    expect(screen.queryByTestId('calendar-connect')).toBeNull();
    expect(screen.queryByTestId('calendar-access-state')).toBeNull();
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
