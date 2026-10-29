import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';
import {
  loadRecordingLibrarySummaries,
  type RecordingLibraryService,
  type RecordingLibrarySummary,
} from './recordingLibraryPanelHelpers';
import { useRecordingDeletionTiming } from './useRecordingDeletionTiming';

/** Effect and deletion recovery reads share one publication owner; committed deletion remains separate. */
export function useRecordingLibraryReadState({
  service,
  automaticTranscription,
  refreshKey,
  onReconciled,
}: {
  readonly service: RecordingLibraryService;
  readonly automaticTranscription: AutomaticTranscriptionSnapshot | null;
  readonly refreshKey?: string | null;
  readonly onReconciled: () => void;
}) {
  const [recordings, setRecordings] = useState<
    readonly RecordingLibrarySummary[]
  >([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [deletedIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const ownership = useMemo(
    () => ({ service, revision: 0, active: false }),
    [service],
  );
  const deletionTiming = useRecordingDeletionTiming(recordings);

  useEffect(() => {
    ownership.active = true;
    return () => {
      ownership.active = false;
      ownership.revision += 1;
    };
  }, [ownership]);

  const publish = useCallback(
    (next: readonly RecordingLibrarySummary[], targetId?: string) => {
      const live = next.filter(item => !deletedIds.has(item.source.id));
      setRecordings(live);
      setSelectedSourceId(current =>
        current &&
        current !== targetId &&
        live.some(item => item.source.id === current)
          ? current
          : null,
      );
      setLoadError(false);
      onReconciled();
    },
    [deletedIds, onReconciled],
  );

  useEffect(() => {
    const revision = ++ownership.revision;
    let active = true;
    const ownsRead = () =>
      active && ownership.active && ownership.revision === revision;
    setLoading(true);
    setLoadError(false);
    loadRecordingLibrarySummaries(service)
      .then(next => {
        if (ownsRead()) publish(next);
      })
      .catch(() => {
        if (ownsRead()) setLoadError(true);
      })
      .finally(() => {
        if (ownsRead()) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    automaticTranscription?.sourceId,
    automaticTranscription?.status,
    refreshKey,
    service,
    ownership,
    publish,
  ]);

  async function refreshAfterDelete(targetId: string): Promise<boolean> {
    const revision = ++ownership.revision;
    const ownsRead = () => ownership.active && ownership.revision === revision;
    setLoading(true);
    try {
      const next = await deletionTiming.readListSummaries(() =>
        loadRecordingLibrarySummaries(service),
      );
      if (!ownsRead()) return false;
      deletionTiming.markListSummaryRefresh();
      deletionTiming.markListRefreshPending();
      publish(next, targetId);
      return true;
    } catch {
      if (ownsRead()) setLoadError(true);
      return false;
    } finally {
      if (ownsRead()) setLoading(false);
    }
  }
  return {
    recordings,
    setRecordings,
    selectedSourceId,
    setSelectedSourceId,
    deletedIds,
    loading,
    loadError,
    deletionTiming,
    refreshAfterDelete,
  };
}
