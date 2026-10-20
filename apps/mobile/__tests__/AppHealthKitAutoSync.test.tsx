import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import App from '../App';
import { syncLocalPreviouslyRequestedHealthKit } from '../src/healthkit/autoSyncLocal';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'skipped',
    attemptedFeatures: [],
  })),
}));
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

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('starts a saved HealthKit refresh when the app opens', async () => {
  const store = createAppointmentStore([]);
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
    />,
  );

  await waitFor(() =>
    expect(syncLocalPreviouslyRequestedHealthKit).toHaveBeenCalledTimes(1),
  );
});

test('refreshes only when a backgrounded app returns to the foreground', async () => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      // AppState broadcasts to HealthKit refresh and the appointment boundary clock independently.
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  const store = createAppointmentStore([]);
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
    />,
  );
  await waitFor(() =>
    expect(syncLocalPreviouslyRequestedHealthKit).toHaveBeenCalledTimes(1),
  );
  expect(listeners.size).toBeGreaterThan(0);

  await act(async () => {
    listeners.forEach(listener => listener('background'));
    listeners.forEach(listener => listener('active'));
  });
  await waitFor(() =>
    expect(syncLocalPreviouslyRequestedHealthKit).toHaveBeenCalledTimes(2),
  );
  await act(async () => {
    listeners.forEach(listener => listener('active'));
  });
  expect(syncLocalPreviouslyRequestedHealthKit).toHaveBeenCalledTimes(2);
});
