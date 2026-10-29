import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingPlaybackService } from './recordingTypes';

export type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';

export type RecordingDeleteNotice = 'error' | 'cleanup-pending' | null;

export interface RecordingLibraryPanelProps {
  readonly service: RecordingLibraryService;
  readonly onNewRecording?: () => void;
  readonly onOpenRecording?: (
    summary: RecordingLibrarySummary,
    autoPlay: boolean,
  ) => void;
  readonly transcriptService?: TranscriptEvidenceService;
  readonly automaticTranscription?: AutomaticTranscriptionSnapshot | null;
  readonly fallbackExportSourceId?: string | null;
  readonly refreshKey?: string | null;
  readonly selectedSummarySourceId?: string | null;
  readonly onSourceDeleted?: (sourceId: string) => void;
  readonly actionsDisabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly playbackService?: RecordingPlaybackService;
}

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
