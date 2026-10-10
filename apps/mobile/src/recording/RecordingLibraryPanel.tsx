import { useEffect, useState } from 'react';
import { Button, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingSourceRecord } from './recordingTypes';
import RecordingDeletionNotice from './RecordingDeletionNotice';
import RecordingDeletionConfirmation from './RecordingDeletionConfirmation';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import type { RecordingLibraryService } from './recordingLibraryService';
import { formatRecordedAt } from './formatRecordedAt';

type DeleteNotice = 'error' | 'cleanup-pending' | null;

interface RecordingLibraryPanelProps {
  readonly service: RecordingLibraryService;
  readonly transcriptService?: TranscriptEvidenceService;
  readonly refreshKey?: string | null;
  readonly onSourceDeleted?: (sourceId: string) => void;
  readonly actionsDisabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
}

/** Shows the latest or selected transcript with one shared delete confirmation. */
export default function RecordingLibraryPanel({
  service,
  transcriptService,
  refreshKey,
  onSourceDeleted,
  actionsDisabled = false,
  onBusyChange,
}: RecordingLibraryPanelProps) {
  const [recordings, setRecordings] = useState<
    readonly RecordingSourceRecord[]
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
    service
      .list()
      .then(next => {
        if (!active) return;
        setRecordings(next);
        setSelectedSourceId(current =>
          current && next.some(source => source.id === current)
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
  }, [refreshKey, service]);

  const selected = recordings.find(item => item.id === selectedSourceId);

  function requestDelete(source: RecordingSourceRecord): void {
    setDeleteNotice(null);
    setDeleteTarget(source);
  }

  function requestTranscriptDelete(sourceId: string): void {
    // A stale transcript must not create a confirmation for a source that is no longer listed.
    const source = recordings.find(candidate => candidate.id === sourceId);
    if (source) requestDelete(source);
    else setDeleteNotice('error');
  }

  async function refreshAfterDelete(
    targetId: string,
    wasDeleted: boolean,
  ): Promise<boolean> {
    try {
      const next = await service.list();
      setRecordings(next);
      setSelectedSourceId(current =>
        current &&
        current !== targetId &&
        next.some(source => source.id === current)
          ? current
          : null,
      );
      return true;
    } catch {
      if (wasDeleted) {
        setRecordings(current =>
          current.filter(source => source.id !== targetId),
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
          {recordings.map(source => (
            <View
              key={source.id}
              style={styles.item}
              testID={`recording-library-item-${source.id}`}
            >
              <Text style={styles.copy}>{source.title}</Text>
              <Text style={styles.copy}>
                {formatRecordedAt(source.recordedAt)}
              </Text>
              <View style={styles.actions}>
                <Button
                  disabled={disabled}
                  onPress={() => setSelectedSourceId(source.id)}
                  testID={`recording-details-${source.id}`}
                  title={t('recording.library.details')}
                />
                <Button
                  disabled={disabled}
                  onPress={() => requestDelete(source)}
                  testID={`recording-delete-${source.id}`}
                  title={t('recording.library.delete')}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {selected ? (
        <View style={styles.detail} testID="recording-detail">
          <Text accessibilityRole="header" style={styles.title}>
            {selected.title}
          </Text>
          <Text style={styles.copy} testID="recording-detail-date">
            {formatRecordedAt(selected.recordedAt)}
          </Text>
          <View style={styles.actions}>
            <Button
              disabled={disabled}
              onPress={() => setSelectedSourceId(null)}
              testID="recording-detail-close"
              title={t('recording.library.closeDetails')}
            />
            <Button
              disabled={disabled}
              onPress={() => requestDelete(selected)}
              testID="recording-detail-delete"
              title={t('recording.library.delete')}
            />
          </View>
        </View>
      ) : null}
      <TranscriptEvidencePanel
        key={JSON.stringify(recordings.map(source => source.id))}
        deletionBusy={disabled}
        onRequestDelete={requestTranscriptDelete}
        recordingSourceId={selected?.id}
        service={transcriptService}
      />
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
