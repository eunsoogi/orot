import type { RecordingDeletionTimingProbe } from './recordingDeletionTiming';
import type { RecordingSourceRecord } from './recordingTypes';

/** Shared library contracts; the optional probe carries timings without recording identity or content. */
export type RecordingTranscriptReviewState =
  'notTranscribed' | 'unreviewed' | 'needsReview' | 'reviewed' | 'unavailable';

export interface RecordingLibrarySummary {
  readonly source: RecordingSourceRecord;
  readonly durationMs: number | null;
  readonly transcriptReviewState: RecordingTranscriptReviewState;
}

export interface RecordingDeletionResult {
  readonly audioCleanupPending: boolean;
}

export interface RecordingAudioDeletion {
  reconcile(sourceIds: readonly string[]): Promise<void>;
  stage(sourceId: string): Promise<void>;
  restore(sourceId: string): Promise<void>;
  commit(sourceId: string): Promise<void>;
}

/** The optional commit receipt is for presentation only; the queue still owns audio cleanup. */
export interface RecordingLibraryService {
  list(): Promise<readonly RecordingSourceRecord[]>;
  readonly listSummaries?: () => Promise<readonly RecordingLibrarySummary[]>;
  deleteRecording(
    sourceId: string,
    timingProbe?: RecordingDeletionTimingProbe,
  ): Promise<RecordingDeletionResult>;
  readonly deleteRecordingWithCommit?: (
    sourceId: string,
    onCommitted: () => void,
    timingProbe?: RecordingDeletionTimingProbe,
  ) => Promise<RecordingDeletionResult>;
}
