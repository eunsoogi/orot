import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';

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
