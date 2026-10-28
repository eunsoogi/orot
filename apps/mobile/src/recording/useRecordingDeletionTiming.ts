import { useContext, useEffect, useRef } from 'react';
import {
  markRecordingDeletionTiming,
  RecordingDeletionTimingContext,
  withRecordingDeletionTiming,
} from './recordingDeletionTiming';
import type { RecordingLibraryService } from './recordingLibraryServiceTypes';
import type { RecordingLibrarySummary } from './recordingLibraryServiceTypes';

/** Connects the opt-in measurement harness to committed progress and list updates. */
export function useRecordingDeletionTiming(
  recordings: readonly RecordingLibrarySummary[],
) {
  const probe = useContext(RecordingDeletionTimingContext);
  const pendingListRefresh = useRef(false);

  useEffect(() => {
    if (!pendingListRefresh.current) return;
    pendingListRefresh.current = false;
    // Record the refresh after React commits the row state, not when an update is requested.
    markRecordingDeletionTiming(probe ?? undefined, 'list-refresh');
  }, [recordings, probe]);

  return {
    markConfirmationTap: () =>
      markRecordingDeletionTiming(probe ?? undefined, 'confirmation-tap'),
    markProgressPresented: probe
      ? () => markRecordingDeletionTiming(probe, 'progress-presented')
      : undefined,
    markListRefreshPending: () => {
      pendingListRefresh.current = true;
    },
    markListSummaryRefresh: () =>
      markRecordingDeletionTiming(probe ?? undefined, 'list-summary-refresh'),
    readListSummaries: <T>(operation: () => Promise<T>) =>
      probe
        ? withRecordingDeletionTiming(probe, 'list-summary-read', operation)
        : operation(),
    deleteRecording: (service: RecordingLibraryService, sourceId: string) =>
      probe
        ? service.deleteRecording(sourceId, probe)
        : service.deleteRecording(sourceId),
  };
}
