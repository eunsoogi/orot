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
jest.mock('../src/healthkit/healthObservationLibrary', () => ({
  listLocalHealthObservations: jest.fn(async () => []),
}));

// Startup recovery is covered separately; these route tests use injected records.
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));

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

async function openHealthRecords() {
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  expect(screen.getByTestId('records-open-health-library')).toBeTruthy();
  expect(screen.queryByTestId('records-health-import')).toBeNull();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-open-health-library'));
}

// The chart and its separate list keep the shared Back and Home actions available.
async function waitForNavigationBackEnabled() {
  await waitFor(() =>
    expect(screen.getByTestId('navigation-back')).toBeEnabled(),
  );
}

test('opens the chart-first health library without a manual blood-pressure import', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('app-screen-correlation'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadHealthObservations = jest.fn(async () => [...observations]);
  await renderApp({ loadHealthObservations });

  await openHealthRecords();
  expect(await screen.findByRole('header', { name: '건강 기록' })).toBeTruthy();
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('health-record-chart-blood_pressure').props
      .accessibilityLabel,
  ).toContain('120 mmHg');
  expect(
    screen.getByTestId('health-record-chart-blood_pressure').props
      .accessibilityLabel,
  ).toContain('80 mmHg');
  expect(loadHealthObservations).toHaveBeenCalledTimes(1);
  expect(importLocalBloodPressure).not.toHaveBeenCalled();

  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-blood_pressure'),
  );
  expect(
    (await screen.findByTestId('health-record-row-0-systolic')).props
      .accessibilityLabel,
  ).toBe('수축기 120 mmHg');
  expect(
    screen.getByTestId('health-record-row-0-diastolic').props
      .accessibilityLabel,
  ).toBe('이완기 80 mmHg');
});

test('keeps the blood-pressure probe loader compatible with the chart library', async () => {
  const observations = mapBloodPressureCorrelation(
    correlation('legacy-app-loader'),
    '2026-10-05T10:00:00.000Z',
  ).observations;
  const loadBloodPressureObservations = jest.fn(async () => [...observations]);
  await renderApp({ loadBloodPressureObservations });

  await openHealthRecords();
  expect(
    await screen.findByTestId('health-record-chart-blood_pressure'),
  ).toBeTruthy();
  expect(loadBloodPressureObservations).toHaveBeenCalledTimes(1);
});

test('keeps the health library in its own scroller beside shared navigation', async () => {
  await renderApp({ loadHealthObservations: async () => [] });
  await openHealthRecords();

  expect(await screen.findByRole('header', { name: '건강 기록' })).toBeTruthy();
  await waitForNavigationBackEnabled();
  const routeRoot = screen.getByTestId('navigation-keyboard-avoiding-root');
  const routeContents = within(routeRoot);
  expect(routeContents.getByTestId('health-records-scroll')).toBeVisible();
  expect(screen.queryByTestId('navigation-route-scroll')).toBeNull();
  expect(screen.getByTestId('navigation-back')).toBeVisible();
  expect(screen.getByTestId('navigation-home')).toBeVisible();
  expect(screen.queryByTestId('blood-pressure-import')).toBeNull();
});
