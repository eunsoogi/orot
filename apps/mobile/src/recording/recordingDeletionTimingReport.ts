import type {
  RecordingDeletionTimingMark,
  RecordingDeletionTimingOutcome,
  RecordingDeletionTimingSpan,
} from './recordingDeletionTiming';

export interface RecordingDeletionTimingEvent {
  readonly stage: RecordingDeletionTimingMark | RecordingDeletionTimingSpan;
  readonly phase: 'mark' | 'begin' | 'end';
  readonly elapsedMs: number;
  readonly outcome?: RecordingDeletionTimingOutcome;
}

export interface RecordingDeletionTimingReport {
  readonly schema: 'orot.recording-deletion-timing.v1';
  readonly clock: 'performance.now';
  readonly unit: 'ms';
  readonly complete: boolean;
  readonly succeeded: boolean;
  readonly events: readonly RecordingDeletionTimingEvent[];
  readonly durationsMs: {
    readonly confirmationToProgress: number | null;
    /** Absent from earlier v1 samples; it includes only acquisition of the library's serial queue. */
    readonly libraryQueueWait: number | null;
    readonly sourceRead: number | null;
    readonly stopCheck: number | null;
    readonly audioStaging: number | null;
    readonly memoryOpen: number | null;
    readonly derivedDataCleanup: number | null;
    readonly databaseDeleteCommit: number | null;
    readonly audioCleanup: number | null;
    readonly audioCleanupToListRefresh: number | null;
    readonly confirmationToListRefresh: number | null;
    readonly listSummaryRead: number | null;
  };
}
