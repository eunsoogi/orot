import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { t } from '../i18n';
import {
  transcriptEvidenceService,
  type TranscriptEvidenceService,
  type TranscriptRecordingView,
} from '../transcription/transcriptEvidenceService';
import {
  EmptyRecordingTranscriptError,
  formatTranscriptExport,
  recordingExportService,
  type RecordingExportService,
} from './recordingExportService';
import { recordingControlStyles as styles } from './RecordingControls.styles';

interface RecordingExportPanelProps {
  recordingSourceId: string;
  transcriptService?: TranscriptEvidenceService;
  exportService?: RecordingExportService;
}

type ExportError = 'load' | 'missingAudio' | 'emptyTranscript' | 'share';

function exportErrorLabel(error: ExportError): string {
  switch (error) {
    case 'load':
      return t('recording.export.error.load');
    case 'missingAudio':
      return t('recording.export.error.missingAudio');
    case 'emptyTranscript':
      return t('recording.export.error.emptyTranscript');
    case 'share':
      return t('recording.export.error.share');
  }
}

function shareError(error: unknown): ExportError {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'RECORDING_EXPORT_SOURCE_MISSING' ? 'missingAudio' : 'share';
}

export default function RecordingExportPanel({
  recordingSourceId,
  transcriptService = transcriptEvidenceService,
  exportService = recordingExportService,
}: RecordingExportPanelProps) {
  const [view, setView] = useState<TranscriptRecordingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ExportError | null>(null);
  const [status, setStatus] = useState<'completed' | 'cancelled' | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setView(null);
    setError(null);
    transcriptService
      .load(recordingSourceId)
      .then(
        next => {
          if (active) setView(next);
        },
        () => {
          if (active) setError('load');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordingSourceId, transcriptService]);

  async function shareAudio(): Promise<void> {
    // Audio export reads the saved file directly and must stay available if transcript lookup fails.
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await exportService.shareAudio(recordingSourceId));
    } catch (reason) {
      setError(shareError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function shareTranscript(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const current = await transcriptService.load(recordingSourceId);
      if (!current) {
        setError('emptyTranscript');
        return;
      }
      setView(current);
      const text = formatTranscriptExport(current);
      setStatus(await exportService.shareTranscript(text));
    } catch (reason) {
      setError(
        reason instanceof EmptyRecordingTranscriptError
          ? 'emptyTranscript'
          : 'share',
      );
    } finally {
      setBusy(false);
    }
  }

  const hasTranscript = Boolean(view?.segments.length);
  return (
    <View style={styles.result} testID="recording-export-panel">
      <Text accessibilityRole="header">{t('recording.export.title')}</Text>
      <Button
        disabled={busy}
        onPress={shareAudio}
        testID="recording-export-audio"
        title={t('recording.export.audio')}
      />
      {/* Re-read on press so a transcript created after this panel mounts stays exportable. */}
      <Button
        disabled={busy || loading}
        onPress={shareTranscript}
        testID="recording-export-transcript"
        title={t('recording.export.transcript')}
      />
      {!loading && !hasTranscript && !error ? (
        <Text>{t('recording.export.emptyTranscript')}</Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="recording-export-error"
        >
          {exportErrorLabel(error)}
        </Text>
      ) : null}
      {status ? (
        <Text testID="recording-export-status">
          {t(`recording.export.status.${status}`)}
        </Text>
      ) : null}
    </View>
  );
}
