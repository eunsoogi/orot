import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import App from '../App';
import {
  importLocalBloodPressure,
  listLocalBloodPressureObservations,
} from '../src/healthkit/bloodPressure/importLocal';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { correlation } from '../src/healthkit/bloodPressure/testSupport';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));

// The dedicated backup recovery test covers startup; route tests avoid loading SQLCipher.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));

// Detox covers this route with a synthetic HealthKit fixture; no real account is read.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

async function renderApp(props: ComponentProps<typeof App> = {}) {
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      {...props}
    />,
  );
}

async function openBloodPressure() {
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await fireEvent.press(screen.getByTestId('records-open-blood-pressure'));
}

test('opens the BP import screen, displays persisted source status, and returns home', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('app-screen-correlation'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  jest
    .mocked(listLocalBloodPressureObservations)
    .mockResolvedValue([...observations]);
  jest.mocked(importLocalBloodPressure).mockResolvedValue({
    status: 'completed',
    readAuthorization: 'notObservable',
    upserted: 0,
    deleted: 0,
    cursorAdvanced: false,
  });
  await renderApp();

  await openBloodPressure();
  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
  expect(await screen.findByText('수축기 120 mmHg')).toBeTruthy();
  expect(screen.getAllByText('원본 정보 제공 안 됨')).toHaveLength(2);
  expect(importLocalBloodPressure).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));
  expect(importLocalBloodPressure).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText('새로운 혈압 기록 변경이 없어요.'),
  ).toBeTruthy();

  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(screen.getByTestId('records-title')).toBeTruthy();
});

test('keeps blood pressure list scrolling inside the shared safe area', async () => {
  const loadBloodPressureObservations = jest.fn(async () => []);
  await renderApp({ loadBloodPressureObservations });

  await openBloodPressure();

  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
  // Keep the screen-owned scroller beside the shared bottom navigation action.
  const routeRoot = screen.getByTestId('navigation-keyboard-avoiding-root');
  const routeContents = within(routeRoot);
  expect(routeRoot).toBeVisible();
  expect(screen.queryByTestId('navigation-route-scroll')).toBeNull();
  expect(routeContents.getByTestId('blood-pressure-scroll')).toBeVisible();
  expect(routeContents.getByTestId('blood-pressure-import')).toBeVisible();
  expect(screen.getByTestId('navigation-back')).toBeVisible();
  expect(loadBloodPressureObservations).toHaveBeenCalledTimes(1);
});
