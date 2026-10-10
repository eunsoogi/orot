import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SourceRecord, TranscriptEvidenceSegment } from '@orot/domain';
import type { RecordingExportService } from '../recordingExportService';
import RecordingExportPanel from '../RecordingExportPanel';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';

const source: SourceRecord = {
  id: 'recording-cleanup-failure',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

const transcriptSegment: TranscriptEvidenceSegment = {
  id: `${source.id}:segment:0:r1`,
  transcriptId: `${source.id}:segment:0`,
  recordingSourceId: source.id,
  segmentOrdinal: 0,
  revision: 1,
  text: '원문 전사',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 250, endMs: 1801 },
  effectiveAt: source.effectiveAt,
  recordedAt: source.recordedAt,
  ingestedAt: source.ingestedAt,
  provenance: {
    origin: 'derived',
    sourceRecordIds: [source.id],
    source: {
      system: 'Apple Speech',
      sourceIdentifier: 'fixture',
      sourceVersion: 'fixture-v1',
    },
  },
  reviewState: { status: 'unreviewed' },
};

const transcriptService: TranscriptEvidenceService = {
  load: async () => ({ source, segments: [], staleArtifacts: [] }),
  transcribe: async () => [],
  correct: async () => {
    throw new Error('Unused in cleanup failure test.');
  },
  play: async segment => ({
    startMs: segment.audioRange.startMs,
    endMs: segment.audioRange.endMs,
    actualStartMs: segment.audioRange.startMs,
  }),
};

test('reports temporary cleanup failure without claiming the share result', async () => {
  const shareAudio = jest.fn(async () => {
    throw Object.assign(new Error('cleanup failed'), {
      code: 'RECORDING_EXPORT_CLEANUP_FAILED',
    });
  });
  const exportService: RecordingExportService = {
    shareAudio,
    shareTranscript: async () => 'completed',
  };
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '공유는 진행됐을 수 있지만 임시 파일을 정리하지 못했어요. 앱을 다시 시작한 뒤 다시 시도해 주세요.',
  );
  expect(screen.queryByTestId('recording-export-status')).toBeNull();
  expect(shareAudio).toHaveBeenCalledWith(source.id);
});

test('reports temporary cleanup failure from transcript export with its recovery message', async () => {
  const shareTranscript = jest.fn(async () => {
    throw Object.assign(new Error('cleanup failed'), {
      code: 'RECORDING_EXPORT_CLEANUP_FAILED',
    });
  });
  const exportService: RecordingExportService = {
    shareAudio: async () => 'completed',
    shareTranscript,
  };
  const transcriptServiceWithContent: TranscriptEvidenceService = {
    ...transcriptService,
    load: async () => ({
      source,
      segments: [transcriptSegment],
      staleArtifacts: [],
    }),
  };
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptServiceWithContent}
      exportService={exportService}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('recording-export-transcript'),
  );
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '공유는 진행됐을 수 있지만 임시 파일을 정리하지 못했어요. 앱을 다시 시작한 뒤 다시 시도해 주세요.',
  );
  expect(screen.queryByTestId('recording-export-status')).toBeNull();
  expect(shareTranscript).toHaveBeenCalledWith(
    expect.stringContaining('원문 전사'),
  );
});
