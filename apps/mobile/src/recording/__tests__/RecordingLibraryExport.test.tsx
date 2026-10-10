import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingLibraryService } from '../recordingLibraryService';

const savedRecording: SourceRecord = {
  id: 'recording-from-history',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '이전 상담 녹음',
};

const transcript: TranscriptEvidenceSegment = {
  id: `${savedRecording.id}:segment:0:r1`,
  transcriptId: `${savedRecording.id}:segment:0`,
  recordingSourceId: savedRecording.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '지난 상담 전사',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 0, endMs: 1000 },
  effectiveAt: savedRecording.effectiveAt,
  recordedAt: savedRecording.recordedAt,
  ingestedAt: savedRecording.ingestedAt,
  provenance: { origin: 'derived', sourceRecordIds: [savedRecording.id] },
  reviewState: { status: 'unreviewed' },
};

test('offers separate audio and transcript exports for a saved library recording', async () => {
  const library: RecordingLibraryService = {
    list: async () => [savedRecording],
    deleteRecording: async () => ({ audioCleanupPending: false }),
  };
  const transcriptService: TranscriptEvidenceService = {
    load: jest.fn(async () => ({
      source: savedRecording,
      segments: [transcript],
      staleArtifacts: [],
    })),
    transcribe: async () => [],
    correct: async () => transcript,
    play: async segment => ({
      startMs: segment.audioRange.startMs,
      endMs: segment.audioRange.endMs,
      actualStartMs: segment.audioRange.startMs,
    }),
  };

  await render(
    <RecordingLibraryPanel
      service={library}
      transcriptService={transcriptService}
    />,
  );
  await screen.findByTestId(`recording-library-item-${savedRecording.id}`);
  expect(screen.queryByTestId('recording-export-panel')).toBeNull();

  // Persisted recordings remain exportable after the in-memory lastRecording is gone.
  await fireEvent.press(
    screen.getByTestId(`recording-details-${savedRecording.id}`),
  );

  expect(await screen.findByTestId('recording-export-audio')).toBeTruthy();
  expect(await screen.findByTestId('recording-export-transcript')).toBeTruthy();
});
