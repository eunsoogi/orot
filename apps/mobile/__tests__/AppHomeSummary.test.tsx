import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
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
  expect(screen.getByTestId('home-overview-sections')).toBeTruthy();
  expect(screen.getByTestId('home-next-visit-panel')).toBeTruthy();
  expect(screen.getByTestId('home-recent-records-panel')).toBeTruthy();
  expect(screen.getAllByTestId('home-prepare-visit')).toHaveLength(1);
  expect(screen.getByText('새봄의원')).toBeTruthy();
  expect(screen.getByText('상담 녹음')).toBeTruthy();
  expect(screen.queryByTestId('ai-feature-visit-questions')).toBeNull();
  expect(screen.queryByTestId('settings-open-provider')).toBeNull();
});

test('keeps an ongoing calendar appointment visible and shows its end time', async () => {
  const now = Date.now();
  const endsAt = new Date(now + 30 * 60_000).toISOString();
  const store = createAppointmentStore([
    {
      id: 'ongoing-visit',
      effectiveAt: new Date(now - 10 * 60_000).toISOString(),
      endsAt,
      recordedAt: new Date(now).toISOString(),
      ingestedAt: new Date(now).toISOString(),
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'scheduled',
      clinicLabel: '진행 중 진료',
    },
  ]);
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
    />,
  );
  expect(await screen.findByTestId('home-next-appointment')).toBeTruthy();
  expect(screen.getByText('진행 중 진료')).toBeTruthy();
  const { formatTime } = require('../src/i18n');
  expect(screen.getByTestId('home-next-appointment')).toHaveTextContent(
    new RegExp(formatTime(new Date(endsAt))),
  );
  expect(screen.getByTestId('home-empty-recordings')).toBeTruthy();
});

test('keeps Home summaries independent while each loader recovers from failure', async () => {
  const now = new Date();
  const store = createAppointmentStore([
    {
      id: 'next-visit',
      effectiveAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      recordedAt: now.toISOString(),
      ingestedAt: now.toISOString(),
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      status: 'scheduled',
      clinicLabel: '새봄의원',
    },
  ]);
  const loadAppointments = jest
    .fn()
    .mockRejectedValueOnce(new Error('Appointment load failed'))
    .mockResolvedValue(store.repository);
  const loadRecordings = jest
    .fn()
    .mockRejectedValueOnce(new Error('Recording load failed'))
    .mockResolvedValue([savedSource]);

  await render(
    <App loadAppointments={loadAppointments} loadRecordings={loadRecordings} />,
  );

  expect(await screen.findByTestId('home-appointments-retry')).toBeTruthy();
  expect(await screen.findByTestId('home-recordings-retry')).toBeTruthy();
  expect(screen.getByTestId('home-next-visit-panel')).toBeTruthy();
  expect(screen.getByTestId('home-recent-records-panel')).toBeTruthy();

  // Each panel owns its retry path, so recovering one summary cannot replace the other.
  await fireEvent.press(screen.getByTestId('home-appointments-retry'));
  await fireEvent.press(screen.getByTestId('home-recordings-retry'));

  await waitFor(() => {
    expect(screen.getByText('새봄의원')).toBeTruthy();
    expect(screen.getByText('상담 녹음')).toBeTruthy();
  });
  expect(loadAppointments).toHaveBeenCalledTimes(2);
  expect(loadRecordings).toHaveBeenCalledTimes(2);
});
