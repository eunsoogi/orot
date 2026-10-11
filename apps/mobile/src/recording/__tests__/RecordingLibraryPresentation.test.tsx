import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordingService } from '../recordingTypes';
import type { RecordingLibraryService } from '../recordingLibraryService';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from '../RecordingLibraryPanel';

const source: SourceRecord = {
  id: 'recording-ui-1',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:06:12.000Z',
  ingestedAt: '2026-10-05T10:06:13.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
  recordingDurationMs: 372000,
};

const segment: TranscriptEvidenceSegment = {
  id: 'recording-ui-1:segment:0:r1',
  transcriptId: 'recording-ui-1:segment:0',
  recordingSourceId: source.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '저장된 전사 문장',
  language: 'ko-KR',
  recordingDurationMs: 372000,
  audioRange: { startMs: 0, endMs: 6000 },
  effectiveAt: source.effectiveAt,
  recordedAt: source.recordedAt,
  ingestedAt: source.ingestedAt,
  provenance: {
    origin: 'derived',
    sourceRecordIds: [source.id],
    source: {
      system: 'Apple Speech',
      sourceIdentifier: 'speech_transcriber',
      sourceVersion: 'iOS 27',
      productType: 'on-device-speech-transcription',
    },
  },
  reviewState: { status: 'unreviewed' },
};

const library: RecordingLibraryService = {
  list: async () => [source],
  listSummaries: async () => [
    { source, durationMs: 372000, transcriptReviewState: 'unreviewed' },
  ],
  deleteRecording: async () => ({ audioCleanupPending: false }),
};

const transcript: TranscriptEvidenceService = {
  load: async () => ({ source, segments: [segment], staleArtifacts: [] }),
  transcribe: async () => [segment],
  correct: async () => segment,
  play: jest.fn(async () => ({
    startMs: 0,
    endMs: 6000,
    actualStartMs: 0,
  })),
};

const playback: Pick<RecordingService, 'playRange'> = {
  playRange: jest.fn(async () => ({
    startMs: 0,
    endMs: 372000,
    actualStartMs: 0,
  })),
};

test('shows saved audio review details, plays the recording and segment, and hides engine metadata', async () => {
  await render(
    <RecordingLibraryPanel
      playbackService={playback}
      service={library}
      transcriptService={transcript}
    />,
  );

  const card = await screen.findByTestId(
    'recording-library-item-recording-ui-1',
  );
  expect(card).toHaveTextContent(/상담 녹음/u);
  expect(card).toHaveTextContent(/06:12/u);
  expect(card).toHaveTextContent(/검토 전 초안/u);

  await fireEvent.press(screen.getByTestId('recording-details-recording-ui-1'));
  expect(await screen.findByTestId('recording-playback-controls')).toBeTruthy();
  expect(screen.getByTestId('recording-detail-duration')).toHaveTextContent(
    '06:12',
  );
  expect(screen.getByTestId('transcript-review-0')).toHaveTextContent(
    '검토 전 초안',
  );
  expect(screen.queryByText('speech_transcriber')).toBeNull();
  expect(screen.queryByText('iOS 27')).toBeNull();

  await fireEvent.press(screen.getByTestId('recording-playback-button'));
  expect(playback.playRange).toHaveBeenCalledWith(source.id, 0, 372000);
  await fireEvent.press(screen.getByTestId('transcript-play-0'));
  expect(transcript.play).toHaveBeenCalledWith(segment);
  await fireEvent.press(screen.getByTestId('transcript-edit-0'));
  expect(screen.getByTestId('transcript-input-0')).toBeTruthy();
  expect(screen.getByTestId('recording-export-audio')).toBeTruthy();
  expect(screen.getByTestId('recording-detail-delete')).toBeTruthy();
});
