import { useMemo, useRef, useState } from 'react';
import { loadRecentMaterial } from '../generatedReports/recentMaterialReader';
import { readProtectedRecentMaterialPage } from '../generatedReports/certifiedRecentMaterialPage';
import { subscribeAgentMemoryVisibility } from '../storage/agentMemoryVisibilityEvents';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
import { subscribeRecentSourceSaved } from '../storage/recentSourceEvents';
import type { RecordsRecentSourcesProps } from './RecordsRecentSources';
import {
  buildRecentRecordEntries,
  groupRecentRecords,
  recentPageSize,
  type RecentRecordEntry,
} from './RecordsRecentTimeline';
import {
  loadRecentSourceMaterial,
  readSelectedRecentRecording,
} from './recentSourceReader';
import { useRecentPageDemand } from './useRecentPageDemand';
import { useRecentSavedMaterial } from './useRecentSavedMaterial';
import { refreshRecentPages } from './recentPageRefresh';
import {
  describeRecentFeed,
  recentStreamHasError,
} from './recentFeedPresentation';

/** Independent cursor streams share one visible depth without blocking healthy sources. */
export function useRecordsRecentFeed(props: RecordsRecentSourcesProps) {
  const {
    active = true,
    ownership,
    tabAuthority,
    recentMaterialReadyLease,
    showAll = false,
    pagedAudio = false,
    pagedDocuments = false,
    recordings,
    documents,
    recordingState,
    documentsState,
    documentsError,
    onRetryRecordings,
    onRetryDocuments,
    onOpenReport,
    onOpenMemory,
    onOpenMedicalDocument,
    onOpenRecording,
    onOpenSavedRecordings,
  } = props;
  const scopedMaterial = useMemo(() => {
    if (!recentMaterialReadyLease) return undefined;
    const lease = recentMaterialReadyLease;
    return {
      load: Object.assign(
        (
          before?: Parameters<typeof loadRecentMaterial>[0],
          options?: Parameters<typeof readProtectedRecentMaterialPage>[2],
        ) => {
          if (!options) throw new Error('Missing protected Records request.');
          return readProtectedRecentMaterialPage(lease, before, options);
        },
        { sourceIsCurrent: () => lease.isCurrent() },
      ),
      subscribe: (current: () => boolean, invalidate: () => void) =>
        subscribeAgentMemoryVisibility(
          lease.database,
          () => lease.isCurrent() && current(),
          invalidate,
        ),
    };
  }, [recentMaterialReadyLease]);
  const reports = useRecentSavedMaterial(
    active,
    ownership,
    scopedMaterial?.load ?? loadRecentMaterial,
    showAll,
    Boolean(onOpenReport),
    tabAuthority,
    undefined,
    Boolean(scopedMaterial),
    scopedMaterial?.subscribe,
  );
  const media = useRecentSavedMaterial(
    active,
    ownership,
    loadRecentSourceMaterial,
    showAll,
    pagedAudio || pagedDocuments,
    tabAuthority,
    subscribeRecentSourceSaved,
    true,
  );
  const [limit, setLimit] = useState(recentPageSize);
  const requestedDepth = useRef(recentPageSize);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const retryRefresh = useRef(false);
  const reportDemand = useRecentPageDemand(reports, recentPageSize);
  const mediaDemand = useRecentPageDemand(media, recentPageSize);
  const records = useMemo(
    () =>
      buildRecentRecordEntries(
        pagedAudio ? [] : recordings,
        pagedDocuments ? [] : documents,
        reports.rows,
        media.rows.filter(row =>
          row.kind === 'audio_recording' ? pagedAudio : pagedDocuments,
        ),
      ),
    [
      documents,
      media.rows,
      pagedAudio,
      pagedDocuments,
      recordings,
      reports.rows,
    ],
  );
  const streams = [
    ...(onOpenReport ? [reports] : []),
    ...(pagedAudio || pagedDocuments ? [media] : []),
  ];
  async function refresh(acceptGesture?: () => void) {
    if (refreshInFlight.current || !reports.isRouteCurrent()) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    retryRefresh.current = false;
    acceptGesture?.();
    try {
      await refreshRecentPages(
        streams.map(stream => stream.prepareRefresh),
        () => {
          requestedDepth.current = recentPageSize;
          setLimit(recentPageSize);
        },
        () => {
          retryRefresh.current = true;
        },
      );
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }
  useNavigationRouteRefresh(showAll && active && streams.length > 0, refresh);
  const legacyRecordingState = pagedAudio ? 'ready' : recordingState;
  const legacyDocumentState = pagedDocuments ? 'ready' : documentsState;
  const { certified, partial, loadErrors } = describeRecentFeed(records, {
    reports: onOpenReport ? reports : undefined,
    media: pagedAudio || pagedDocuments ? media : undefined,
    legacyRecordingFailed: legacyRecordingState === 'failed',
    legacyDocumentFailed: legacyDocumentState === 'failed',
    documentsError,
  });
  const groups = groupRecentRecords(certified, new Date(), showAll ? limit : 3);
  const hasKnownMore = certified.length > limit;
  const canAdvance =
    !refreshing &&
    !partial &&
    (hasKnownMore ||
      (Boolean(onOpenReport) && reportDemand.canAdvance) ||
      ((pagedAudio || pagedDocuments) && mediaDemand.canAdvance));

  function showMore() {
    if (
      !reports.isRouteCurrent() ||
      refreshInFlight.current ||
      !canAdvance ||
      requestedDepth.current !== limit
    )
      return;
    const nextDepth = limit + recentPageSize;
    requestedDepth.current = nextDepth;
    setLimit(nextDepth);
    // Optional reads may still be pending. Each cursor fulfills only its own demand.
    if (onOpenReport) reportDemand.requestMore();
    if (pagedAudio || pagedDocuments) mediaDemand.requestMore();
  }

  function retrySources() {
    if (!reports.isRouteCurrent() || refreshInFlight.current) return;
    if (retryRefresh.current) {
      refresh();
      return;
    }
    for (const stream of streams) {
      if (recentStreamHasError(stream.state)) stream.loadMore();
    }
    if (legacyRecordingState === 'failed') onRetryRecordings();
    if (legacyDocumentState === 'failed') onRetryDocuments();
  }

  function openRecord(record: RecentRecordEntry) {
    if (!reports.isRouteCurrent()) return;
    if (record.source) {
      media.open(record.source, async (row, revalidate, current) => {
        if (row.kind === 'medical_document') {
          onOpenMedicalDocument(row.id);
          return;
        }
        // Only one user-selected recording re-enters the exact existing detail owner.
        try {
          const source = await readSelectedRecentRecording(row.id);
          if (source && (await revalidate()) && current())
            onOpenRecording?.(source);
        } catch {
          // A failed local read must not open another recording or trigger playback.
        }
      });
    } else if (record.material) {
      reports.open(record.material, item => {
        if (item.origin === 'memory') onOpenMemory?.(item.id);
        else onOpenReport?.(item);
      });
    } else if (record.kind === 'medical_document') {
      onOpenMedicalDocument(record.id);
    } else {
      const source = recordings.find(row => row.id === record.id);
      if (source && onOpenRecording) onOpenRecording(source);
      else onOpenSavedRecordings();
    }
  }
  return {
    records: certified,
    isFresh:
      streams.length > 0 && streams.every(stream => stream.state === 'ready'),
    groups,
    showMore,
    retrySources,
    openRecord,
    isCurrent: reports.isRouteCurrent,
    more:
      !partial &&
      (hasKnownMore ||
        streams.some(stream => stream.more && stream.rows.length > 0)),
    isLoading:
      legacyRecordingState === 'loading' ||
      legacyDocumentState === 'loading' ||
      streams.some(
        stream =>
          stream.state === 'loading' || (active && stream.state === 'idle'),
      ),
    canAdvance,
    loadErrors,
  };
}
