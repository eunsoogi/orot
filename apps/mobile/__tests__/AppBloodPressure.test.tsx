import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import App from '../App';
import { importLocalBloodPressure } from '../src/healthkit/bloodPressure/importLocal';
import { mapBloodPressureCorrelation } from '../src/healthkit/bloodPressure/mapper';
import { correlation } from '../src/healthkit/bloodPressure/testSupport';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
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

// The saved-record list keeps the shared back action disabled while it loads.
async function waitForNavigationBackEnabled() {
  await waitFor(() =>
    expect(screen.getByTestId('navigation-back')).toBeEnabled(),
  );
}

test('shows an import summary and opens the saved health records library', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('app-screen-correlation'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadHealthObservations = jest.fn(async () => [...observations]);
  jest.mocked(importLocalBloodPressure).mockResolvedValue({
    status: 'completed',
    readAuthorization: 'notObservable',
    upserted: 0,
    deleted: 0,
    cursorAdvanced: false,
  });
  await renderApp({ loadHealthObservations });

  await openBloodPressure();
  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
  expect(screen.queryByText('수축기 120 mmHg')).toBeNull();
  expect(loadHealthObservations).not.toHaveBeenCalled();
  expect(importLocalBloodPressure).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('blood-pressure-import'));
  expect(importLocalBloodPressure).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByTestId('blood-pressure-result-saved-count'),
  ).toHaveTextContent('0개');
  expect(
    screen.getByTestId('blood-pressure-result-deleted-count'),
  ).toHaveTextContent('0개');

  await fireEvent.press(screen.getByTestId('blood-pressure-open-library'));
  expect(await screen.findByRole('header', { name: '건강 기록' })).toBeTruthy();
  expect(await screen.findByText('수축기')).toBeTruthy();
  expect(await screen.findByText('120 mmHg')).toBeTruthy();
  expect(loadHealthObservations).toHaveBeenCalledTimes(1);

  await waitForNavigationBackEnabled();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByRole('header', { name: '혈압 기록' })).toBeTruthy();
});

test('keeps the import action in its own shared safe-area scroller', async () => {
  const loadHealthObservations = jest.fn(async () => []);
  await renderApp({ loadHealthObservations });

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
  expect(loadHealthObservations).not.toHaveBeenCalled();
});
