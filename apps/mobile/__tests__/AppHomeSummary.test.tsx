import { render, screen, waitFor } from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import App from '../App';
import { savedSource } from '../src/recording/recordingScreenSupport';
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

test('shows the next saved appointment and recent recording on Home', async () => {
  const now = new Date();
  const appointment: Appointment = {
    id: 'next-visit',
    effectiveAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    recordedAt: now.toISOString(),
    ingestedAt: now.toISOString(),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
    clinicLabel: '새봄의원',
  };
  const store = createAppointmentStore([appointment]);
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => [savedSource]}
    />,
  );

  await waitFor(() =>
    expect(screen.getByTestId('home-next-appointment')).toBeTruthy(),
  );
  expect(screen.getByText('새봄의원')).toBeTruthy();
  expect(screen.getByText('상담 녹음')).toBeTruthy();
  expect(screen.queryByTestId('ai-feature-visit-questions')).toBeNull();
  expect(screen.queryByTestId('settings-open-provider')).toBeNull();
});
