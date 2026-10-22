import { fireEvent, render, screen } from '@testing-library/react-native';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingSourceRecord } from '../recordingTypes';

const source: RecordingSourceRecord = {
  id: 'saved-source',
  sourceKind: 'audio_recording',
  title: '저장한 상담',
  effectiveAt: '2026-10-18T00:00:00Z',
  recordedAt: '2026-10-18T00:00:00Z',
  ingestedAt: '2026-10-18T00:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};

test.each([12000, null])(
  'routes playback with duration %s without embedding review below the list',
  async durationMs => {
    const onOpenRecording = jest.fn();
    await render(
      <RecordingLibraryPanel
        onOpenRecording={onOpenRecording}
        service={{
          list: async () => [source],
          listSummaries: async () => [
            { source, durationMs, transcriptReviewState: 'unavailable' },
          ],
          deleteRecording: jest.fn(),
        }}
      />,
    );
    await fireEvent.press(screen.getByTestId('recording-details-saved-source'));
    expect(onOpenRecording).toHaveBeenLastCalledWith(
      expect.objectContaining({ source }),
      false,
    );
    expect(screen.queryByTestId('recording-detail')).toBeNull();
    await fireEvent.press(
      screen.getByTestId('recording-playback-list-button-saved-source'),
    );
    expect(onOpenRecording).toHaveBeenLastCalledWith(
      expect.objectContaining({ source }),
      true,
    );
  },
);
