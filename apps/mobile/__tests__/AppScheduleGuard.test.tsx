import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import App from '../App';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import { navigationText } from '../src/i18n/navigation';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

function createCalendarBridge(event: CalendarEvent): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [event],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

test('guards a calendar draft and allows navigation after explicit save', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const store = createAppointmentStore();
  const effectiveAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const event: CalendarEvent = {
    calendarEventIdentifier: 'selected-visit',
    effectiveAt: effectiveAt.toISOString(),
    endsAt: new Date(effectiveAt.getTime() + 60 * 60 * 1000).toISOString(),
    calendarEventSnapshot: {
      title: '새봄의원 진료',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      calendarBridge={createCalendarBridge(event)}
    />,
  );

  await fireEvent.press(screen.getByTestId('navigation-tab-schedule'));
  await fireEvent.press(screen.getByTestId('calendar-connect'));
  await fireEvent.press(
    await screen.findByTestId('calendar-candidate-selected-visit'),
  );
  expect(screen.getByTestId('schedule-open-appointments')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('navigation-tab-home'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);
  expect(screen.getByTestId('calendar-selection')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('calendar-confirm-selected'));
  expect(await screen.findByText('다음 외래 방문을 저장했어요.')).toBeTruthy();
  expect(screen.getByTestId('schedule-open-appointments')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('navigation-tab-home'));
  await waitFor(() => expect(screen.getByTestId('welcome-title')).toBeTruthy());
  expect(alert).toHaveBeenCalledTimes(1);
});

async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
