import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingControls from '../RecordingControls';
import type { RecordingLibraryService } from '../recordingLibraryService';
import { completed, savedSource } from '../recordingScreenSupport';

jest.mock('../RecordingExportPanel', () => {
  // Expose the target so an older selection can be distinguished from the session fallback.
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ recordingSourceId }: { recordingSourceId: string }) =>
      React.createElement(View, {
        testID: `recording-export-panel-${recordingSourceId}`,
      }),
  };
});

test('selection replaces the current recording export target', async () => {
  const latest = { ...savedSource, id: 'latest-recording' };
  const older = {
    ...savedSource,
    id: 'older-recording',
    title: '이전 녹음',
  };
  const library: RecordingLibraryService = {
    list: async () => [latest, older],
    deleteRecording: async () => ({ audioCleanupPending: false }),
  };
  const transcriptService: TranscriptEvidenceService = {
    load: async () => null,
    transcribe: async () => [],
    correct: async () => {
      throw new Error('Unused in export selection test.');
    },
    play: async segment => ({
      startMs: segment.audioRange.startMs,
      endMs: segment.audioRange.endMs,
      actualStartMs: segment.audioRange.startMs,
    }),
  };

  await render(
    <RecordingControls
      onBack={jest.fn()}
      stateReady
      status="completed"
      durationMs={completed.durationMs}
      consentAcknowledged
      onToggleConsent={jest.fn()}
      busy={false}
      onStart={jest.fn()}
      onPause={jest.fn()}
      onResume={jest.fn()}
      onStop={async () => {}}
      lastRecording={{ ...completed, id: latest.id }}
      sourceSaved
      onRetrySourceSave={jest.fn()}
      error=""
      syntheticProbeAvailable={false}
      syntheticProbeReady={false}
      onPrepareSyntheticProbe={jest.fn()}
      onPrepareSyntheticStartFailure={jest.fn()}
      onSendInterruption={jest.fn()}
      probeError=""
      transcriptService={transcriptService}
      recordingLibraryService={library}
    />,
  );

  await screen.findByTestId(`recording-library-item-${older.id}`);
  await fireEvent.press(screen.getByTestId(`recording-details-${older.id}`));

  expect(
    await screen.findByTestId(`recording-export-panel-${older.id}`),
  ).toBeTruthy();
  expect(
    screen.queryByTestId(`recording-export-panel-${latest.id}`),
  ).toBeNull();
  expect(screen.getAllByTestId(/^recording-export-panel-/)).toHaveLength(1);
});
