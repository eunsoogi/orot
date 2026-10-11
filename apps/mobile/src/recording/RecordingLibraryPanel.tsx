import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingService, RecordingSourceRecord } from './recordingTypes';
import { recordingService } from './recordingService';
import RecordingDeletionNotice from './RecordingDeletionNotice';
import RecordingDeletionConfirmation from './RecordingDeletionConfirmation';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import type {
  RecordingLibraryService,
  RecordingLibrarySummary,
} from './recordingLibraryService';
import RecordingExportPanel from './RecordingExportPanel';
import RecordingLibrarySummaryRow from './RecordingLibrarySummaryRow';
import RecordingLibraryDetail from './RecordingLibraryDetail';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

type DeleteNotice = 'error' | 'cleanup-pending' | null;

interface RecordingLibraryPanelProps {
  readonly service: RecordingLibraryService;
  readonly transcriptService?: TranscriptEvidenceService;
  readonly automaticTranscription?: AutomaticTranscriptionSnapshot | null;
  readonly fallbackExportSourceId?: string | null;
  readonly refreshKey?: string | null;
  readonly onSourceDeleted?: (sourceId: string) => void;
  readonly actionsDisabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly playbackService?: Pick<RecordingService, 'playRange'>;
}

async function loadSummaries(
  service: RecordingLibraryService,
): Promise<readonly RecordingLibrarySummary[]> {
  if (service.listSummaries) return service.listSummaries();
  // Older test adapters can still render rows without making an unsupported review-state claim.
  return (await service.list()).map(source => ({
    source,
    durationMs: source.recordingDurationMs ?? null,
    transcriptReviewState: 'unavailable',
  }));
}

/** Shows real saved-audio summaries and one selected detail with shared delete recovery. */
export default function RecordingLibraryPanel({
  service,
  transcriptService,
  automaticTranscription = null,
  fallbackExportSourceId,
  refreshKey,
  onSourceDeleted,
  actionsDisabled = false,
  onBusyChange,
  playbackService = recordingService,
}: RecordingLibraryPanelProps) {
  const [recordings, setRecordings] = useState<
    readonly RecordingLibrarySummary[]
  >([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<RecordingSourceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<DeleteNotice>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    loadSummaries(service)
      .then(next => {
        if (!active) return;
        setRecordings(next);
        setSelectedSourceId(current =>
          current && next.some(item => item.source.id === current)
            ? current
            : null,
        );
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    automaticTranscription?.sourceId,
    automaticTranscription?.status,
    refreshKey,
    service,
  ]);

  const selected = recordings.find(item => item.source.id === selectedSourceId);

  function requestDelete(source: RecordingSourceRecord): void {
    setDeleteNotice(null);
    setDeleteTarget(source);
  }

  function requestTranscriptDelete(sourceId: string): void {
    // A stale transcript must not create a confirmation for a source that is no longer listed.
    const source = recordings.find(
      candidate => candidate.source.id === sourceId,
    )?.source;
    if (source) requestDelete(source);
    else setDeleteNotice('error');
  }

  async function refreshAfterDelete(
    targetId: string,
    wasDeleted: boolean,
  ): Promise<boolean> {
    try {
      const next = await loadSummaries(service);
      setRecordings(next);
      setSelectedSourceId(current =>
        current &&
        current !== targetId &&
        next.some(item => item.source.id === current)
          ? current
          : null,
      );
      return true;
    } catch {
      if (wasDeleted) {
        setRecordings(current =>
          current.filter(item => item.source.id !== targetId),
        );
        setSelectedSourceId(current => (current === targetId ? null : current));
      }
      setLoadError(true);
      return false;
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target || busy) return;
    setBusy(true);
    onBusyChange?.(true);
    setDeleteNotice(null);
    try {
      const result = await service.deleteRecording(target.id);
      setDeleteTarget(null);
      onSourceDeleted?.(target.id);
      const refreshed = await refreshAfterDelete(target.id, true);
      if (result.audioCleanupPending && !refreshed) {
        setDeleteNotice('cleanup-pending');
      }
    } catch {
      setDeleteTarget(null);
      setDeleteNotice('error');
      // Re-read after failure so an interrupted operation is shown from persisted state.
      await refreshAfterDelete(target.id, false);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const disabled = busy || actionsDisabled;
  const exportSourceId = selected?.source.id ?? fallbackExportSourceId ?? null;
  const transcriptSourceId =
    selected?.source.id ??
    automaticTranscription?.sourceId ??
    fallbackExportSourceId ??
    null;
  const transcriptionStatus =
    automaticTranscription &&
    automaticTranscription.sourceId === transcriptSourceId
      ? automaticTranscription.status
      : undefined;

  return (
    <View style={styles.container} testID="recording-library-panel">
      <Text accessibilityRole="header" style={styles.title}>
        {t('recording.library.title')}
      </Text>
      {loading ? <Text>{t('recording.library.loading')}</Text> : null}
      {loadError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('recording.library.loadError')}
        </Text>
      ) : null}
      {!loading && recordings.length === 0 ? (
        <Text style={styles.copy} testID="recording-library-empty">
          {t('recording.library.empty')}
        </Text>
      ) : null}
      {recordings.length > 0 ? (
        <View style={styles.list} testID="recording-library-list">
          {recordings.map(summary => (
            <RecordingLibrarySummaryRow
              key={summary.source.id}
              summary={summary}
              disabled={disabled}
              onOpen={() => setSelectedSourceId(summary.source.id)}
              onDelete={() => requestDelete(summary.source)}
            />
          ))}
        </View>
      ) : null}
      {selected ? (
        <RecordingLibraryDetail
          summary={selected}
          disabled={disabled}
          playbackService={playbackService}
          onClose={() => setSelectedSourceId(null)}
          onDelete={() => requestDelete(selected.source)}
        />
      ) : null}
      {transcriptSourceId ? (
        <TranscriptEvidencePanel
          key={`${recordings.map(item => item.source.id).join(',')}:${transcriptSourceId}:${transcriptionStatus ?? ''}`}
          deletionBusy={disabled}
          onRequestDelete={selected ? undefined : requestTranscriptDelete}
          recordingSourceId={transcriptSourceId}
          automaticTranscriptionStatus={transcriptionStatus}
          service={transcriptService}
        />
      ) : null}
      {/* A selected persisted row replaces the current-session fallback so only one source can be exported. */}
      {exportSourceId ? (
        <RecordingExportPanel
          recordingSourceId={exportSourceId}
          transcriptService={transcriptService}
        />
      ) : null}
      <RecordingDeletionConfirmation
        busy={disabled}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        target={deleteTarget}
      />
      <RecordingDeletionNotice notice={deleteNotice} />
    </View>
  );
}
