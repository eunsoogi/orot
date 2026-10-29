import { useState } from 'react';
import { View } from 'react-native';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingService } from './recordingService';
import RecordingDeletionNotice from './RecordingDeletionNotice';
import RecordingDeletionConfirmation from './RecordingDeletionConfirmation';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import {
  recordingLibrarySources,
  type RecordingLibraryPanelProps,
} from './recordingLibraryPanelHelpers';
import RecordingExportPanel from './RecordingExportPanel';
import RecordingLibraryDetail from './RecordingLibraryDetail';
import RecordingLibraryContent from './RecordingLibraryContent';
import { useRecordingLibraryReadState } from './useRecordingLibraryReadState';
import { useRecordingDeleteNotice } from './useRecordingDeleteNotice';

/** Shows real saved-audio summaries and one selected detail with shared delete recovery. */
export default function RecordingLibraryPanel({
  service,
  onNewRecording,
  onOpenRecording,
  transcriptService,
  automaticTranscription = null,
  fallbackExportSourceId,
  refreshKey,
  selectedSummarySourceId = null,
  onSourceDeleted,
  actionsDisabled = false,
  onBusyChange,
  playbackService = recordingService,
}: RecordingLibraryPanelProps) {
  const [playbackRequestSourceId, setPlaybackRequestSourceId] = useState<
    string | null
  >(null);
  const [deleteTarget, setDeleteTarget] =
    useState<RecordingSourceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  // Each operation owns its settlement; export completion must never clear an outstanding deletion.
  const [exportBusy, setExportBusy] = useState(false);
  const notice = useRecordingDeleteNotice(service);
  const { deleteNotice } = notice;
  const {
    recordings,
    setRecordings,
    selectedSourceId,
    setSelectedSourceId,
    deletedIds,
    loading,
    loadError,
    deletionTiming,
    refreshAfterDelete,
  } = useRecordingLibraryReadState({
    service,
    automaticTranscription,
    refreshKey,
    onReconciled: notice.reconciled,
  });

  const selected = recordings.find(item => item.source.id === selectedSourceId);
  // The route context retains only identity; visible metadata comes from the currently loaded library.
  const selectionSummary = selectedSummarySourceId
    ? recordings.find(item => item.source.id === selectedSummarySourceId)
    : undefined;

  function requestDelete(source: RecordingSourceRecord): void {
    notice.clear();
    setDeleteTarget(source);
  }

  function requestTranscriptDelete(sourceId: string): void {
    // A stale transcript must not create a confirmation for a source that is no longer listed.
    const source = recordings.find(
      candidate => candidate.source.id === sourceId,
    )?.source;
    if (source) requestDelete(source);
    else notice.requestError();
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget;
    if (!target || busy || exportBusy || actionsDisabled) return;
    deletionTiming.markConfirmationTap();
    setBusy(true);
    onBusyChange?.(true);
    const operation = notice.begin();
    try {
      const result = await deletionTiming.deleteRecording(service, target.id);
      setDeleteTarget(null);
      onSourceDeleted?.(target.id);
      // The cascade has committed. Publish its result immediately, without a full metadata reread.
      deletedIds.add(target.id);
      deletionTiming.markListRefreshPending();
      setRecordings(current =>
        current.filter(item => item.source.id !== target.id),
      );
      setSelectedSourceId(current => (current === target.id ? null : current));
      if (result.audioCleanupPending) {
        notice.cleanupPending(operation);
        refreshAfterDelete(target.id);
      }
    } catch {
      setDeleteTarget(null);
      notice.fail(operation);
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
    const summary = recordings.find(item => item.source.id === sourceId);
    if (onOpenRecording && summary) {
      onOpenRecording(summary, autoPlay);
      return;
    }
    // Both list actions share the same source and busy boundary; playback still uses the detail control.
    setPlaybackRequestSourceId(autoPlay ? sourceId : null);
    setSelectedSourceId(sourceId);
  }
  const { exportSourceId, transcriptSourceId, transcriptionStatus } =
    recordingLibrarySources(
      selected?.source.id,
      onOpenRecording ? null : automaticTranscription,
      onOpenRecording ? null : fallbackExportSourceId,
    );

  return (
    <View style={styles.container} testID="recording-library-panel">
      <RecordingLibraryContent
        disabled={disabled}
        loadError={loadError}
        loading={loading}
        onDelete={requestDelete}
        onNewRecording={onNewRecording}
        onOpen={selectSource}
        recordings={recordings}
        selectionSummary={selectionSummary}
      />
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
        onProgressPresented={deletionTiming.markProgressPresented}
        target={deleteTarget}
      />
      <RecordingDeletionNotice notice={deleteNotice} />
    </View>
  );
}
