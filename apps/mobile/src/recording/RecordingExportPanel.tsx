import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
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
import { RecordingDetailActionMenu } from './RecordingDetailActionMenu';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { InlineRecordingExportOptions } from './RecordingExportOption';
import { recordingExportPanelStyles as styles } from './RecordingExportPanel.styles';

interface RecordingExportPanelProps {
  recordingSourceId: string;
  transcriptService?: TranscriptEvidenceService;
  exportService?: RecordingExportService;
  onBusyChange?: (busy: boolean) => void;
  actionsDisabled?: boolean;
  savedDetail?: boolean;
  active?: boolean;
  routeOwner?: NavigationRouteOwnership;
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
  onBusyChange,
  actionsDisabled = false,
  savedDetail = false,
  active = true,
  routeOwner,
}: RecordingExportPanelProps) {
  const [view, setView] = useState<TranscriptRecordingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ExportError | null>(null);
  const [status, setStatus] = useState<'completed' | 'cancelled' | null>(null);
  const selectionRevision = useRef(0);
  const previousSourceId = useRef(recordingSourceId);
  const focused = useRef(active);
  focused.current = active;

  function updateBusy(value: boolean): void {
    setBusy(value);
    // Native backdrop dismissal can also deliver a touch to the library. Keep its source controls disabled until this request settles.
    onBusyChange?.(value);
  }

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
    let loadCurrent = true;
    setLoading(true);
    setView(null);
    setError(null);
    transcriptService
      .load(recordingSourceId)
      .then(
        next => {
          if (loadCurrent) setView(next);
        },
        () => {
          if (loadCurrent) setError('load');
        },
      )
      .finally(() => {
        if (loadCurrent) setLoading(false);
      });
    return () => {
      loadCurrent = false;
    };
  }, [recordingSourceId, transcriptService]);

  async function shareAudio(): Promise<void> {
    if (busy || actionsDisabled || !active || routeOwner?.isCurrent() === false)
      return;
    // Audio export reads the saved file directly and must stay available if transcript lookup fails.
    const requestRevision = selectionRevision.current;
    updateBusy(true);
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
      updateBusy(false);
    }
  }

  async function shareTranscript(): Promise<void> {
    if (busy || actionsDisabled || !active || routeOwner?.isCurrent() === false)
      return;
    const requestRevision = selectionRevision.current;
    updateBusy(true);
    setError(null);
    setStatus(null);
    try {
      const current = await transcriptService.load(recordingSourceId);
      if (
        requestRevision !== selectionRevision.current ||
        !focused.current ||
        routeOwner?.isCurrent() === false
      )
        return;
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
      updateBusy(false);
    }
  }

  const hasTranscript = Boolean(view?.segments.length);
  return (
    <View style={styles.panel} testID="recording-export-panel">
      {savedDetail ? (
        <RecordingDetailActionMenu
          id="recording-export-menu"
          label={t('recording.export.title')}
          icon="square.and.arrow.up"
          sourceId={recordingSourceId}
          active={active}
          owner={routeOwner}
          choices={[
            {
              id: 'audio',
              label: t('recording.export.audio'),
              run: shareAudio,
              disabled: busy || actionsDisabled,
            },
            {
              id: 'transcript',
              label: t('recording.export.transcript'),
              run: shareTranscript,
              disabled: busy || actionsDisabled || loading,
            },
          ]}
        />
      ) : (
        <>
          <Text accessibilityRole="header" style={styles.title}>
            {t('recording.export.title')}
          </Text>
          <Text style={styles.subtitle}>
            {t('recording.export.description')}
          </Text>
          <InlineRecordingExportOptions
            disabled={busy || actionsDisabled}
            transcriptDisabled={loading}
            onAudio={shareAudio}
            onTranscript={shareTranscript}
          />
          <View
            style={styles.privacyNote}
            testID="recording-export-privacy-note"
          >
            <AppSymbol name="info.circle" color={appColors.secondary} />
            <Text style={styles.privacyCopy}>
              {t('recording.export.privacyNote')}
            </Text>
          </View>
          {!loading && !hasTranscript && !error ? (
            <Text>{t('recording.export.emptyTranscript')}</Text>
          ) : null}
        </>
      )}
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
