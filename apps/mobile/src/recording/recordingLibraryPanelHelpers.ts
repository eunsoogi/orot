import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

export type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';

export type RecordingDeleteNotice = 'error' | 'cleanup-pending' | null;

/** Older adapters lack transcript summaries, so their review state must remain unavailable. */
export async function loadRecordingLibrarySummaries(
  service: RecordingLibraryService,
): Promise<readonly RecordingLibrarySummary[]> {
  if (service.listSummaries) return service.listSummaries();
  return (await service.list()).map(source => ({
    source,
    durationMs: source.recordingDurationMs ?? null,
    transcriptReviewState: 'unavailable',
  }));
}

/** Selection overrides session fallbacks; only matching live transcription status belongs to the displayed source. */
export function recordingLibrarySources(
  selectedSourceId: string | undefined,
  automaticTranscription: AutomaticTranscriptionSnapshot | null,
  fallbackExportSourceId?: string | null,
) {
  const exportSourceId = selectedSourceId ?? fallbackExportSourceId ?? null;
  const transcriptSourceId =
    selectedSourceId ??
    automaticTranscription?.sourceId ??
    fallbackExportSourceId ??
    null;
  const transcriptionStatus =
    automaticTranscription?.sourceId === transcriptSourceId
      ? automaticTranscription?.status
      : undefined;
  return { exportSourceId, transcriptSourceId, transcriptionStatus };
}
