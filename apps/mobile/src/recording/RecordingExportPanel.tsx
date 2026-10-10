import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

type ExportError =
  'load' | 'missingAudio' | 'emptyTranscript' | 'cleanup' | 'share';

function exportErrorLabel(error: ExportError): string {
  switch (error) {
    case 'load':
      return t('recording.export.error.load');
    case 'missingAudio':
      return t('recording.export.error.missingAudio');
    case 'emptyTranscript':
      return t('recording.export.error.emptyTranscript');
    case 'cleanup':
      return t('recording.export.error.cleanup');
    case 'share':
      return t('recording.export.error.share');
  }
}

function shareError(error: unknown): ExportError {
  const code = (error as { code?: unknown } | null)?.code;
  // Cleanup failures keep the native export slot occupied, so both paths need the same recovery guidance.
  if (code === 'RECORDING_EXPORT_CLEANUP_FAILED') return 'cleanup';
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
  const selectionRevision = useRef(0);
  const previousSourceId = useRef(recordingSourceId);

  useLayoutEffect(() => {
    if (previousSourceId.current === recordingSourceId) return;
    previousSourceId.current = recordingSourceId;
    // Native sharing can outlive a row selection. Clear feedback before paint and
    // ignore that share's late result.
    selectionRevision.current += 1;
    setError(null);
    setStatus(null);
  }, [recordingSourceId]);

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
    const requestRevision = selectionRevision.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await exportService.shareAudio(recordingSourceId);
      if (requestRevision === selectionRevision.current) {
        setStatus(result);
      }
    } catch (reason) {
      if (requestRevision === selectionRevision.current) {
        setError(shareError(reason));
      }
    } finally {
      setBusy(false);
    }
  }

  async function shareTranscript(): Promise<void> {
    const requestRevision = selectionRevision.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const current = await transcriptService.load(recordingSourceId);
      if (requestRevision !== selectionRevision.current) return;
      if (!current) {
        setError('emptyTranscript');
        return;
      }
      setView(current);
      const text = formatTranscriptExport(current);
      const result = await exportService.shareTranscript(text);
      if (requestRevision === selectionRevision.current) {
        setStatus(result);
      }
    } catch (reason) {
      if (requestRevision === selectionRevision.current) {
        setError(
          reason instanceof EmptyRecordingTranscriptError
            ? 'emptyTranscript'
            : shareError(reason),
        );
      }
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
