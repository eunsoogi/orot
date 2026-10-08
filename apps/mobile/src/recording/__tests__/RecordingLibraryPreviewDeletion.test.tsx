import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from '../RecordingLibraryPanel';
import type { RecordingLibraryService } from '../recordingLibraryService';

const remainingSource: SourceRecord = {
  id: 'recording-remaining',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '남아 있는 녹음',
};

const latestSource: SourceRecord = {
  ...remainingSource,
  id: 'recording-latest',
  recordedAt: '2026-10-06T10:00:05.000Z',
  title: '최신 녹음',
};

const remainingSegment: TranscriptEvidenceSegment = {
  id: 'recording-remaining:segment:0:r1',
  transcriptId: 'recording-remaining:segment:0',
  recordingSourceId: remainingSource.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '남아 있는 전사 내용',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 0, endMs: 1000 },
  effectiveAt: remainingSource.effectiveAt,
  recordedAt: remainingSource.recordedAt,
  ingestedAt: remainingSource.ingestedAt,
  provenance: { origin: 'derived', sourceRecordIds: [remainingSource.id] },
  reviewState: { status: 'unreviewed' },
};

const latestSegment: TranscriptEvidenceSegment = {
  ...remainingSegment,
  id: 'recording-latest:segment:0:r1',
  transcriptId: 'recording-latest:segment:0',
  recordingSourceId: latestSource.id,
  text: '삭제되어야 할 최신 전사',
  effectiveAt: latestSource.effectiveAt,
  recordedAt: latestSource.recordedAt,
  ingestedAt: latestSource.ingestedAt,
  provenance: { origin: 'derived', sourceRecordIds: [latestSource.id] },
};

test('latest transcript preview switches to the remaining recording after deletion', async () => {
  let sources = [latestSource, remainingSource];
  const library: RecordingLibraryService = {
    list: jest.fn(async () => sources),
    deleteRecording: jest.fn(async sourceId => {
      sources = sources.filter(source => source.id !== sourceId);
      return { audioCleanupPending: false };
    }),
  };
  const transcript: TranscriptEvidenceService = {
    load: jest.fn(async sourceId => {
      const source = sourceId
        ? sources.find(candidate => candidate.id === sourceId)
        : sources[0];
      return source
        ? {
            source,
            segments:
              source.id === latestSource.id
                ? [latestSegment]
                : [remainingSegment],
            staleArtifacts: [],
          }
        : null;
    }),
    transcribe: jest.fn(async () => []),
    correct: jest.fn(),
    play: jest.fn(),
  };

  await render(
    <RecordingLibraryPanel service={library} transcriptService={transcript} />,
  );
  expect(await screen.findByText(latestSegment.text)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('recording-transcript-delete'));
  await fireEvent.press(await screen.findByTestId('recording-delete-confirm'));

  await waitFor(() => {
    expect(screen.queryByText(latestSegment.text)).toBeNull();
    expect(screen.getByText(remainingSegment.text)).toBeTruthy();
  });
  expect(library.deleteRecording).toHaveBeenCalledWith(latestSource.id);
  expect(transcript.load).toHaveBeenLastCalledWith(undefined);
});
