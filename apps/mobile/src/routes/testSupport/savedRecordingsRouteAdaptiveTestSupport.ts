import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from '../../recording/recordingLibraryService';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';

/** Keep shared fixtures outside __tests__ so Jest collects only executable suites. */
export const source: RecordingSourceRecord = {
  id: 'recording-source',
  sourceKind: 'audio_recording',
  effectiveAt: '2026-10-05T10:00:00.000Z',
  recordedAt: '2026-10-05T10:00:05.000Z',
  ingestedAt: '2026-10-05T10:00:06.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: 'Saved recording',
};

const summary: RecordingLibrarySummary = {
  source,
  durationMs: 93_000,
  transcriptReviewState: 'unreviewed',
};

/** Supplies one persisted summary and removes it when the production delete flow commits. */
export function createLibraryService(): RecordingLibraryService {
  let summaries: readonly RecordingLibrarySummary[] = [summary];
  return {
    list: jest.fn(async () => summaries.map(item => item.source)),
    listSummaries: jest.fn(async () => summaries),
    deleteRecording: jest.fn(async (sourceId: string) => {
      summaries = summaries.filter(item => item.source.id !== sourceId);
      return { audioCleanupPending: false };
    }),
  };
}

/** Gives the review stub a clean exit state while the saved route uses its production leave guard. */
export const cleanReviewLeaveState = {
  readState: () => ({
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  }),
};

/** Builds a test payload in the native bridge shape for the production geometry resolver. */
export function geometry(
  width: number,
  divided: boolean,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 700 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: 445, y: 0, width: 10, height: 700 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}
