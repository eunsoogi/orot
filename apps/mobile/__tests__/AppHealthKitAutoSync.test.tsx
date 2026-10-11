import { render, waitFor } from '@testing-library/react-native';
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
