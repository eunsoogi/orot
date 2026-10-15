import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import { recordingExportService } from '../recordingExportService';
import { savedSource } from '../recordingScreenSupport';

const current = { ...savedSource, id: 'current-share-source' };
const older = {
  ...savedSource,
  id: 'older-share-source',
  title: '이전 상담 녹음',
};
const segment: TranscriptEvidenceSegment = {
  id: 'current-segment',
  transcriptId: 'current-transcript',
  recordingSourceId: current.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '합성 상담 전사',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 0, endMs: 1000 },
  effectiveAt: current.effectiveAt,
  recordedAt: current.recordedAt,
  ingestedAt: current.ingestedAt,
  provenance: { origin: 'derived', sourceRecordIds: [current.id] },
  reviewState: { status: 'unreviewed' },
};

afterEach(() => jest.restoreAllMocks());

test.each(['audio', 'transcript'] as const)(
  '%s sharing preserves the selected source until success, cancellation or failure settles',
  async kind => {
    for (const outcome of ['completed', 'cancelled', 'failed'] as const) {
      let resolveShare!: (value: 'completed' | 'cancelled') => void;
      let rejectShare!: (reason: Error) => void;
      const pending = new Promise<'completed' | 'cancelled'>(
        (resolve, reject) => {
          resolveShare = resolve;
          rejectShare = reject;
        },
      );
      const share = jest
        .spyOn(
          recordingExportService,
          kind === 'audio' ? 'shareAudio' : 'shareTranscript',
        )
        .mockImplementation(() => pending);
      const transcriptService: TranscriptEvidenceService = {
        load: jest.fn(async id => ({
          source: id === older.id ? older : current,
          segments: [segment],
          staleArtifacts: [],
        })),
        transcribe: async () => [],
        correct: async () => segment,
        play: jest.fn(),
      };
      const library = {
        list: async () => [current, older],
        deleteRecording: jest.fn(),
      };
      const panel = await render(
        <RecordingLibraryPanel
          service={library}
          transcriptService={transcriptService}
          fallbackExportSourceId={current.id}
        />,
      );
      const row = await screen.findByTestId(`recording-details-${older.id}`);
      await waitFor(() =>
        expect(screen.getByTestId(`recording-export-${kind}`)).toBeEnabled(),
      );
      await fireEvent.press(screen.getByTestId(`recording-export-${kind}`));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      // A native backdrop gesture can reach the list. Its actual controls must reject selection while the share is pending.
      expect(row).toBeDisabled();
      expect(
        screen.getByTestId(`recording-playback-list-button-${older.id}`),
      ).toBeDisabled();
      expect(screen.getByTestId(`recording-delete-${older.id}`)).toBeDisabled();
      await fireEvent.press(row);
      expect(screen.queryByTestId('recording-detail')).toBeNull();
      await act(async () => {
        if (outcome === 'failed')
          rejectShare(new Error('Native activity failed'));
        else resolveShare(outcome);
        await pending.catch(() => {});
      });
      await waitFor(() => expect(row).toBeEnabled());
      if (outcome === 'failed')
        expect(screen.getByTestId('recording-export-error')).toBeTruthy();
      else
        expect(screen.getByTestId('recording-export-status')).toHaveTextContent(
          outcome === 'cancelled'
            ? '내보내기를 취소했어요.'
            : '파일을 공유하거나 저장했어요.',
        );
      // Completion restores normal selection, and feedback from the previous source still clears.
      await fireEvent.press(row);
      expect(await screen.findByTestId('recording-detail')).toBeTruthy();
      expect(screen.queryByTestId('recording-export-status')).toBeNull();
      expect(screen.queryByTestId('recording-export-error')).toBeNull();
      expect(library.deleteRecording).not.toHaveBeenCalled();
      await panel.unmount();
      share.mockRestore();
    }
  },
);
