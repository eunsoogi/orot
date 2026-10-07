import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';
import MedicalAppointmentClassificationScreen from '../MedicalAppointmentClassificationScreen';

function event(identifier: string, title: string, date: string): CalendarEvent {
  return {
    calendarEventIdentifier: identifier,
    effectiveAt: `${date}T00:00:00.000Z`,
    endsAt: `${date}T01:00:00.000Z`,
    calendarEventSnapshot: {
      title,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function repository(
  confirmCalendarEvent: (event: CalendarEvent) => Promise<unknown> = async () =>
    undefined,
): AppointmentRepository {
  return {
    list: jest.fn(async () => []),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(confirmCalendarEvent),
    reconfirmCalendarEvent: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

async function renderScreen(
  queries: readonly (readonly CalendarEvent[])[],
  appointments: AppointmentRepository,
) {
  const allEvents = queries.flat();
  const byId = new Map(
    allEvents.map(candidate => [candidate.calendarEventIdentifier, candidate]),
  );
  let queryIndex = 0;
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [...queries[Math.min(queryIndex++, queries.length - 1)]!],
    })),
    findEvent: jest.fn(async identifier => ({
      access: 'fullAccess' as const,
      event: byId.get(identifier) ?? null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  await render(
    <MedicalAppointmentClassificationScreen
      bridge={bridge}
      repository={appointments}
      selectedProvider={null}
      recipient={null}
      consent={null}
      onOpenManual={jest.fn()}
    />,
  );
  return bridge;
}

describe('medical appointment candidate selection regressions', () => {
  it('distinguishes same-title occurrences and saves the selected one', async () => {
    const first = event('private-event-1', '치과 진료', '2035-06-02');
    const second = event('private-event-2', '치과 진료', '2035-06-03');
    const appointments = repository();
    const bridge = await renderScreen([[first, second]], appointments);

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));

    expect(await screen.findAllByText('치과 진료')).toHaveLength(2);
    expect(
      screen.getByText('2035년 6월 2일 09:00–10:00 · Asia/Seoul'),
    ).toBeTruthy();
    expect(
      screen.getByText('2035년 6월 3일 09:00–10:00 · Asia/Seoul'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId('medical-appointment-save-calendar-candidate-2'),
    );

    await waitFor(() =>
      expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(second),
    );
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalledWith(first);
    expect(bridge.findEvent).toHaveBeenCalledWith(
      'private-event-2',
      null,
      null,
    );
  });

  it('keeps the displayed occurrence stable while its save is pending', async () => {
    const first = event('private-event-a', 'A 진료', '2035-06-02');
    const next = event('private-event-b', 'B 진료', '2035-06-03');
    let finishSave!: () => void;
    const delayedSave = new Promise<void>(resolve => {
      finishSave = resolve;
    });
    const appointments = repository(() => delayedSave);
    const bridge = await renderScreen([[first], [next]], appointments);

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(await screen.findByText('A 진료')).toBeTruthy();
    fireEvent.press(
      screen.getByTestId('medical-appointment-save-calendar-candidate-1'),
    );
    await waitFor(() =>
      expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(first),
    );

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));

    expect(bridge.requestAccessAndListUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A 진료')).toBeTruthy();
    expect(screen.queryByText('B 진료')).toBeNull();

    finishSave();
    expect(await screen.findAllByText('일정을 저장했습니다.')).toHaveLength(2);
    expect(
      screen.getByTestId('medical-appointment-save-calendar-candidate-1').props
        .accessibilityState.disabled,
    ).toBe(true);
  });
});
