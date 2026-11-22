import { useMemo, useRef, useState } from 'react';
import { loadRecentMaterial } from '../generatedReports/recentMaterialReader';
import { t } from '../i18n';
import { subscribeRecentSourceSaved } from '../storage/recentSourceEvents';
import type { RecordsRecentSourcesProps } from './RecordsRecentSources';
import {
  buildRecentRecordEntries,
  certifiedRecentPrefix,
  groupRecentRecords,
  recentPageSize,
  recentStreamFrontier,
  type RecentRecordEntry,
} from './RecordsRecentTimeline';
import {
  loadRecentSourceMaterial,
  readSelectedRecentRecording,
} from './recentSourceReader';
import { useRecentPageDemand } from './useRecentPageDemand';
import { useRecentSavedMaterial } from './useRecentSavedMaterial';

/** Independent cursor streams share one visible depth without blocking healthy sources. */
export function useRecordsRecentFeed(props: RecordsRecentSourcesProps) {
  const {
    active = true,
    ownership,
    tabAuthority,
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
  const reports = useRecentSavedMaterial(
    active,
    ownership,
    loadRecentMaterial,
    showAll,
    Boolean(onOpenReport),
    tabAuthority,
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
  // Publishing below an unresolved cursor can show an old file ahead of an
  // unseen newer report. Keep the certified prefix and one common visible depth.
  const certified = certifiedRecentPrefix(records, [
    ...(onOpenReport ? [recentStreamFrontier(reports, 'material')] : []),
    ...(pagedAudio || pagedDocuments
      ? [recentStreamFrontier(media, 'source')]
      : []),
  ]);
  const groups = groupRecentRecords(certified, new Date(), showAll ? limit : 3);
  const hasKnownMore = certified.length > limit;
  const canAdvance =
    hasKnownMore ||
    (Boolean(onOpenReport) && reportDemand.canAdvance) ||
    ((pagedAudio || pagedDocuments) && mediaDemand.canAdvance);
  const legacyRecordingState = pagedAudio ? 'ready' : recordingState;
  const legacyDocumentState = pagedDocuments ? 'ready' : documentsState;

  function showMore() {
    if (
      !reports.isRouteCurrent() ||
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
    if (!reports.isRouteCurrent()) return;
    for (const stream of streams) {
      if (stream.state === 'failed') stream.loadMore();
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
    groups,
    showMore,
    retrySources,
    openRecord,
    isCurrent: reports.isRouteCurrent,
    more:
      hasKnownMore ||
      streams.some(stream => stream.more && stream.rows.length > 0),
    isLoading:
      legacyRecordingState === 'loading' ||
      legacyDocumentState === 'loading' ||
      streams.some(
        stream =>
          stream.state === 'loading' || (active && stream.state === 'idle'),
      ),
    canAdvance,
    loadErrors: [
      reports.state === 'failed'
        ? t('records.recent.savedMaterialLoadError')
        : null,
      media.state === 'failed' ? t('records.recent.loadError') : null,
      legacyRecordingState === 'failed'
        ? t('recording.library.loadError')
        : null,
      legacyDocumentState === 'failed'
        ? (documentsError ?? t('medicalDocument.source.loadError'))
        : null,
    ].filter((message): message is string => message !== null),
  };
}
