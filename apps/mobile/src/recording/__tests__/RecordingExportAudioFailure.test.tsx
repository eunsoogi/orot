import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SourceRecord } from '@orot/domain';
import type { RecordingExportService } from '../recordingExportService';
import RecordingExportPanel from '../RecordingExportPanel';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';

const source: SourceRecord = {
  id: 'recording-audio-failure',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

const transcriptService: TranscriptEvidenceService = {
  load: async () => ({ source, segments: [], staleArtifacts: [] }),
  transcribe: async () => [],
  correct: async () => {
    throw new Error('Unused in audio export test.');
  },
  play: async segment => ({
    startMs: segment.audioRange.startMs,
    endMs: segment.audioRange.endMs,
    actualStartMs: segment.audioRange.startMs,
  }),
};

test('reports an audio activity failure without claiming export success', async () => {
  const shareAudio = jest.fn(async () => {
    throw Object.assign(new Error('activity failed'), {
      code: 'RECORDING_EXPORT_FAILED',
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

  // Failure stays retryable and must never look like an audio export succeeded.
  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '파일을 내보내지 못했어요. 다시 시도해 주세요.',
  );
  expect(screen.queryByTestId('recording-export-status')).toBeNull();
  expect(shareAudio).toHaveBeenCalledWith(source.id);
});
