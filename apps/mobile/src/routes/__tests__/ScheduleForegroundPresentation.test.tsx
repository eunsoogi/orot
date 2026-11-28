import { useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { CalendarAutoSyncController } from '../../calendar/calendarAutoSync';
import {
  bridge,
  event,
  repository,
} from '../../calendar/calendarLinkingTestFixtures';
import type { UpcomingCalendarEvents } from '../../calendar/types';
import { ScheduleRoute } from '../ScheduleRoute';

test('rereading EventKit on return keeps the chosen month and date painted until actual changes arrive', async () => {
  const originalPhase = AppState.currentState;
  AppState.currentState = 'active';
  const appStateListeners = new Set<(value: AppStateStatus) => void>();
  const appState = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) } as never;
    });
  jest.useFakeTimers().setSystemTime(new Date(2035, 4, 15, 12));
  let resolve!: (value: UpcomingCalendarEvents) => void;
  const pending = new Promise<UpcomingCalendarEvents>(done => {
    resolve = done;
  });
  const baseEvent = event('Original calendar event', '2035-06-02T09:00:00Z');
  const earlier = event('First calendar month', '2035-05-17T09:00:00Z');
  const updated = event('Updated calendar event', baseEvent.effectiveAt);
  const repo = repository(async () => []);
  const native = bridge({
    listUpcomingEvents: jest
      .fn()
      .mockResolvedValueOnce({
        access: 'fullAccess',
        events: [earlier, baseEvent],
      })
      .mockReturnValueOnce(pending),
  });
  const sync = new CalendarAutoSyncController(native);
  function Fixture() {
    const calendarSync = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
    return (
      <ScheduleRoute
        appointmentRepository={repo}
        appointmentState="ready"
        bridge={native}
        calendarSync={calendarSync}
        onRetry={jest.fn()}
        onOpenAppointments={jest.fn()}
        onOpenMedicalAppointments={jest.fn()}
        onAppointmentsChanged={jest.fn()}
      />
    );
  }
  try {
    await sync.start();
    await render(<Fixture />);
    await fireEvent.press(screen.getByTestId('calendar-next-month'));
    await fireEvent.press(screen.getByTestId('calendar-day-2035-06-02'));
    expect(screen.getByText('Original calendar event')).toBeTruthy();
    const title = screen.getByTestId('calendar-month-title');

    await act(async () => {
      for (const phase of ['background', 'active'] as const) {
        AppState.currentState = phase;
        for (const listener of appStateListeners) listener(phase);
      }
    });
    expect(native.listUpcomingEvents).toHaveBeenCalledTimes(2);
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('calendar-month-title')).toBe(title);
    expect(screen.getByText('Original calendar event')).toBeTruthy();
    expect(screen.queryByTestId('calendar-storage-loading')).toBeNull();

    await act(async () => resolve({ access: 'fullAccess', events: [updated] }));
    expect(screen.getByTestId('calendar-month-title')).toBe(title);
    expect(screen.getByText('Updated calendar event')).toBeTruthy();
    expect(screen.queryByText('Original calendar event')).toBeNull();
  } finally {
    sync.stop();
    appState.mockRestore();
    AppState.currentState = originalPhase;
    jest.useRealTimers();
  }
});
