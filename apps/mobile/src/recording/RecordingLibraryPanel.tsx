import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type {
  RecordingPlaybackService,
  RecordingSourceRecord,
} from './recordingTypes';
import { recordingService } from './recordingService';
import RecordingDeletionNotice from './RecordingDeletionNotice';
import RecordingDeletionConfirmation from './RecordingDeletionConfirmation';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import {
  loadRecordingLibrarySummaries,
  recordingLibrarySources,
  type RecordingDeleteNotice,
  type RecordingLibraryService,
  type RecordingLibrarySummary,
} from './recordingLibraryPanelHelpers';
import RecordingExportPanel from './RecordingExportPanel';
import RecordingLibrarySummaryRow from './RecordingLibrarySummaryRow';
import RecordingLibraryDetail from './RecordingLibraryDetail';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

interface RecordingLibraryPanelProps {
  readonly service: RecordingLibraryService;
  readonly transcriptService?: TranscriptEvidenceService;
  readonly automaticTranscription?: AutomaticTranscriptionSnapshot | null;
  readonly fallbackExportSourceId?: string | null;
  readonly refreshKey?: string | null;
  readonly onSourceDeleted?: (sourceId: string) => void;
  readonly actionsDisabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly playbackService?: RecordingPlaybackService;
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
  const [playbackRequestSourceId, setPlaybackRequestSourceId] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] =
    useState<RecordingSourceRecord | null>(null);
  const [deletedIds] = useState(() => new Set<string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Each operation owns its settlement; export completion must never clear an outstanding deletion.
  const [exportBusy, setExportBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<RecordingDeleteNotice>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    loadRecordingLibrarySummaries(service)
      .then(next => {
        if (!active) return;
        setRecordings(next.filter(item => !deletedIds.has(item.source.id)));
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
    deletedIds,
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

  async function refreshAfterDelete(targetId: string): Promise<boolean> {
    try {
      const next = await loadRecordingLibrarySummaries(service);
      setRecordings(next.filter(item => !deletedIds.has(item.source.id)));
      setSelectedSourceId(current =>
        current &&
        current !== targetId &&
        next.some(item => item.source.id === current)
          ? current
          : null,
      );
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target || busy || exportBusy || actionsDisabled) return;
    setBusy(true);
    onBusyChange?.(true);
    setDeleteNotice(null);
    try {
      const result = await service.deleteRecording(target.id);
      setDeleteTarget(null);
      onSourceDeleted?.(target.id);
      // The cascade has committed. Publish its result immediately, without a full metadata reread.
      deletedIds.add(target.id);
      setRecordings(current =>
        current.filter(item => item.source.id !== target.id),
      );
      setSelectedSourceId(current => (current === target.id ? null : current));
      if (result.audioCleanupPending) {
        setDeleteNotice('cleanup-pending');
        void refreshAfterDelete(target.id).then(refreshed => {
          if (refreshed) setDeleteNotice(null);
        });
      }
    } catch {
      setDeleteTarget(null);
      setDeleteNotice('error');
      // Re-read after failure so an interrupted operation is shown from persisted state.
      await refreshAfterDelete(target.id);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const disabled = busy || exportBusy || actionsDisabled;
  function selectSource(sourceId: string, autoPlay = false): void {
    if (disabled) return;
    // Both list actions share the same source and busy boundary; playback still uses the detail control.
    setPlaybackRequestSourceId(autoPlay ? sourceId : null);
    setSelectedSourceId(sourceId);
  }
  const { exportSourceId, transcriptSourceId, transcriptionStatus } =
    recordingLibrarySources(
      selected?.source.id,
      automaticTranscription,
      fallbackExportSourceId,
    );

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
              onOpen={() => selectSource(summary.source.id)}
              onPlay={() => selectSource(summary.source.id, true)}
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
          autoPlay={playbackRequestSourceId === selected.source.id}
          onAutoPlayConsumed={() => setPlaybackRequestSourceId(null)}
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
          onBusyChange={setExportBusy}
          actionsDisabled={busy || actionsDisabled}
        />
      ) : null}
      <RecordingDeletionConfirmation
        busy={busy || actionsDisabled}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        target={deleteTarget}
      />
      <RecordingDeletionNotice notice={deleteNotice} />
    </View>
  );
}
