import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import { savedSource } from '../src/recording/recordingScreenSupport';
import { recordingLibraryService } from '../src/recording/recordingLibraryService';
import { transcriptEvidenceService } from '../src/transcription/transcriptEvidenceService';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'skipped',
    attemptedFeatures: [],
  })),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('opens saved recordings with review and export in the same detail flow and preserves Back navigation', async () => {
  const store = createAppointmentStore();
  jest.spyOn(recordingLibraryService, 'listSummaries').mockResolvedValue([
    {
      source: savedSource,
      durationMs: 12500,
      transcriptReviewState: 'unreviewed',
    },
  ]);
  jest.spyOn(transcriptEvidenceService, 'load').mockResolvedValue({
    source: savedSource,
    segments: [],
    staleArtifacts: [],
  });
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => [savedSource]}
    />,
  );
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  expect(screen.queryByTestId('recording-library-panel')).toBeNull();
  await fireEvent.press(screen.getByTestId('records-open-saved-recordings'));
  await fireEvent.press(
    await screen.findByTestId('recording-details-' + savedSource.id),
  );
  expect(await screen.findByRole('header', { name: '전사 검토' })).toBeTruthy();
  expect(screen.getByTestId('recording-export-panel')).toBeTruthy();
  expect(screen.queryByTestId('recording-open-export')).toBeNull();
  expect(
    await screen.findByRole('header', { name: '녹음 내보내기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('recording-export-audio')).toBeTruthy();
  for (const marker of ['recording-library-panel', 'records-title']) {
    await waitFor(() =>
      expect(screen.getByTestId('navigation-back')).toBeEnabled(),
    );
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(await screen.findByTestId(marker)).toBeTruthy();
  }
  expect(screen.getByTestId('records-open-health-library')).toBeTruthy();
});
