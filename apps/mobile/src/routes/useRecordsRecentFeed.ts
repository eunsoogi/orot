import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadRecentMaterial } from '../generatedReports/recentMaterialReader';
import { readProtectedRecentMaterialPage } from '../generatedReports/certifiedRecentMaterialPage';
import { subscribeAgentMemoryVisibility } from '../storage/agentMemoryVisibilityEvents';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
import { subscribeRecentSourceSaved } from '../storage/recentSourceEvents';
import type { RecordsRecentSourcesProps } from './RecordsRecentSources';
import {
  groupRecentRecords,
  recentPageSize,
  type RecentRecordEntry,
} from './RecordsRecentTimeline';
import { loadRecentSourceMaterial } from './recentSourceReader';
import { openRecentRecord } from './openRecentRecord';
import {
  resolveMountedRecentPaint,
  useMountedRecentRoutePaint,
} from './useMountedRecentRoutePaint';
import { useSettledRecentPaint } from './useSettledRecentPaint';
import { useRecentRecordEntries } from './useRecentRecordEntries';
import { useRecentPageDemand } from './useRecentPageDemand';
import { useRecentSavedMaterial } from './useRecentSavedMaterial';
import { refreshRecentPages } from './recentPageRefresh';
import {
  describeRecentFeed,
  recentStreamHasError,
} from './recentFeedPresentation';

export function useRecordsRecentFeed(
  props: RecordsRecentSourcesProps,
  shield?: Readonly<{ available: boolean; bound: boolean }>,
) {
  const {
    active = true,
    ownership,
    tabAuthority,
    recentMaterialReadyLease,
    showAll = false,
    pagedAudio = false,
    pagedDocuments = false,
    recordingState,
    documentsState,
    documentsError,
    onRetryRecordings,
    onRetryDocuments,
    onOpenReport,
  } = props;
  const warmEligible =
    active &&
    pagedAudio &&
    pagedDocuments &&
    Boolean(onOpenReport && recentMaterialReadyLease);
  const painted = useSettledRecentPaint<{
    records: readonly RecentRecordEntry[];
    groups: ReturnType<typeof groupRecentRecords>;
  }>(warmEligible, ownership, tabAuthority);
  const mounted = useMountedRecentRoutePaint<{
    records: readonly RecentRecordEntry[];
    groups: ReturnType<typeof groupRecentRecords>;
  }>(warmEligible && shield?.bound === true, ownership, tabAuthority);
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
  const paintPort = (publish: typeof painted.publishMedia) =>
    warmEligible ? { blocked: painted.blocked, publish } : undefined;
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
    paintPort(painted.publishMaterial),
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
    undefined,
    paintPort(painted.publishMedia),
  );
  const [limit, setLimit] = useState(recentPageSize);
  const requestedDepth = useRef(recentPageSize);
  const refreshInFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const retryRefresh = useRef(false);
  const reportDemand = useRecentPageDemand(
    reports,
    recentPageSize,
    mounted.retained?.depths.material,
  );
  const mediaDemand = useRecentPageDemand(
    media,
    recentPageSize,
    mounted.retained?.depths.media,
  );
  const records = useRecentRecordEntries(props, media.rows, reports.rows);
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

  const isFresh =
    streams.length > 0 && streams.every(stream => stream.state === 'ready');
  const { holding, snapshot, rebuilt, revision, warm } =
    resolveMountedRecentPaint(
      mounted.retained,
      painted.warm,
      isFresh,
      loadErrors.length > 0,
      media,
      reports,
    );
  useLayoutEffect(() => {
    if (loadErrors.length) mounted.clear();
    else if (rebuilt && !refreshing)
      mounted.commit({ records: certified, groups }, media, reports);
    if (!warm && painted.warm) painted.rejectWarm();
    if (isFresh && !refreshing && loadErrors.length === 0)
      painted.recordPaint(
        { records: certified, groups },
        limit === recentPageSize,
        media.rows,
        reports.rows,
      );
  });
  return {
    records: snapshot?.records ?? certified,
    holdingMountedList: holding,
    shieldRecords: warmEligible && shield?.available === true,
    presentationRevision: revision,
    isFresh,
    warmPaint: Boolean(warm),
    groups: snapshot?.groups ?? groups,
    showMore,
    retrySources,
    retryProtectedPaint: () => refresh(),
    openRecord: (record: RecentRecordEntry) =>
      openRecentRecord(record, props, reports, media),
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
