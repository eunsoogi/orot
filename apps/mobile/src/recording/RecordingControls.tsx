import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { t } from '../i18n';
import { navigationText } from '../i18n/navigation';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import RecordingLibraryPanel from './RecordingLibraryPanel';
import { recordingLibraryService as defaultRecordingLibraryService } from './recordingLibraryService';
import type { RecordingLibraryService } from './recordingLibraryService';
import {
  formatRecordingDuration,
  type CompletedRecording,
  type RecordingPlaybackService,
  type RecordingStatus,
} from './recordingTypes';
import { recordingControlStyles } from './RecordingControls.styles';
import RecordingControlsProbe from './RecordingControlsProbe';
import { useRecordingNavigationLeaveState } from './useRecordingNavigationLeaveState';
import RecordingSessionPanel from './RecordingSessionPanel';
import RecordingGuidancePanel from './RecordingGuidancePanel';
import RecordingScreenHeader from './RecordingScreenHeader';
import RecordingTranscriptionFeedback from './RecordingTranscriptionFeedback';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

interface RecordingControlsProps {
  onBack: () => void;
  onOpenSavedRecordings?: () => void;
  stateReady: boolean;
  status: RecordingStatus;
  durationMs: number;
  amplitude?: number;
  consentAcknowledged: boolean;
  onToggleConsent: () => void;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<void>;
  lastRecording: CompletedRecording | null;
  sourceSaved: boolean;
  onRetrySourceSave: () => void;
  error: string;
  syntheticProbeAvailable: boolean;
  syntheticProbeReady: boolean;
  onPrepareSyntheticProbe: () => void;
  onPrepareSyntheticStartFailure: (
    point: 'beforeFileURL' | 'afterFileCreated',
  ) => void;
  onSendInterruption: (phase: 'began' | 'ended') => void;
  probeError: string;
  transcriptService?: TranscriptEvidenceService;
  automaticTranscription?: AutomaticTranscriptionSnapshot | null;
  onRetryTranscription?: () => void;
  recordingLibraryService?: RecordingLibraryService;
  playbackService?: RecordingPlaybackService;
  onRecordingSourceDeleted?: (sourceId: string) => void;
}

export default function RecordingControls({
  onBack,
  onOpenSavedRecordings,
  stateReady,
  status,
  durationMs,
  amplitude,
  consentAcknowledged,
  onToggleConsent,
  busy,
  onStart,
  onPause,
  onResume,
  onStop,
  lastRecording,
  sourceSaved,
  onRetrySourceSave,
  error,
  syntheticProbeAvailable,
  syntheticProbeReady,
  onPrepareSyntheticProbe,
  onPrepareSyntheticStartFailure,
  onSendInterruption,
  probeError,
  transcriptService,
  automaticTranscription = null,
  onRetryTranscription = () => {},
  recordingLibraryService = defaultRecordingLibraryService,
  playbackService,
  onRecordingSourceDeleted,
}: RecordingControlsProps) {
  const navigationInset = useNavigationContentInset();
  const [deletingRecording, setDeletingRecording] = useState(false);
  const controlsBusy = busy || deletingRecording;
  // The selected saved-recording detail owns the transcript editor and delete action.
  const showRecordingLibrary = status === 'idle' || status === 'completed';
  // Retry only when the permanent audio file is protected and eligible for device backup.
  const sourceRetryPending =
    lastRecording !== null &&
    !sourceSaved &&
    lastRecording.fileProtection === 'complete' &&
    lastRecording.excludedFromBackup === false;
  const { canLeave, hasSharedNavigation } = useRecordingNavigationLeaveState({
    status,
    stateReady,
    busy: controlsBusy,
    sourceRetryPending,
    stopRecording: onStop,
  });
  const showLocalBack =
    canLeave &&
    (status === 'idle' || status === 'completed') &&
    !hasSharedNavigation;
  return (
    // The transcript panel follows the recording controls and must remain reachable on shorter screens.
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[
        recordingControlStyles.container,
        navigationInset,
      ]}
      // Dragging dismisses the transcript keyboard so row actions remain reachable.
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={recordingControlStyles.scroll}
      testID="recording-controls-scroll"
    >
      {showLocalBack ? (
        <View style={recordingControlStyles.back}>
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            testID="recording-back"
            title={navigationText.back.label}
          />
        </View>
      ) : null}
      <RecordingScreenHeader
        controlsBusy={controlsBusy}
        onOpenSavedRecordings={onOpenSavedRecordings}
        sourceRetryPending={sourceRetryPending}
        stateReady={stateReady}
        status={status}
      />
      {/* Stable route-owned panels let the screen reflow without restarting capture or consent state. */}
      <AdaptiveColumns
        primary={
          <RecordingSessionPanel
            status={status}
            durationMs={durationMs}
            amplitude={amplitude}
            controlsBusy={
              controlsBusy || automaticTranscription?.status === 'running'
            }
            sourceRetryPending={sourceRetryPending}
            consentAcknowledged={consentAcknowledged}
            onStart={onStart}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
          />
        }
        secondary={
          <RecordingGuidancePanel
            status={status}
            consentAcknowledged={consentAcknowledged}
            controlsBusy={controlsBusy}
            onToggleConsent={onToggleConsent}
          />
        }
        routeKey="recording"
        testID="recording-content-columns"
      />
      {lastRecording ? (
        <View style={recordingControlStyles.result} testID="recording-result">
          <Text accessibilityRole="alert" style={recordingControlStyles.status}>
            {sourceSaved ? t('recording.saved') : t('recording.sourcePending')}
          </Text>
          {/* Keep the source ID for storage and export only; it is not user-facing completion detail. */}
          <Text testID="recording-saved-duration">
            {t('recording.duration', {
              duration: formatRecordingDuration(lastRecording.durationMs),
            })}
          </Text>
          {sourceRetryPending ? (
            <Button
              disabled={busy}
              onPress={onRetrySourceSave}
              testID="recording-retry-save"
              title={t('recording.retrySave')}
            />
          ) : null}
          {__DEV__ ? (
            <Text testID="recording-file-protection">
              {lastRecording.fileProtection}:
              {String(lastRecording.excludedFromBackup)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <RecordingTranscriptionFeedback
        snapshot={automaticTranscription}
        onRetry={onRetryTranscription}
      />
      {showRecordingLibrary && !onOpenSavedRecordings ? (
        <RecordingLibraryPanel
          actionsDisabled={busy}
          fallbackExportSourceId={
            lastRecording && sourceSaved ? lastRecording.id : null
          }
          onBusyChange={setDeletingRecording}
          onSourceDeleted={onRecordingSourceDeleted}
          service={recordingLibraryService}
          transcriptService={transcriptService}
          playbackService={playbackService}
          automaticTranscription={automaticTranscription}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={recordingControlStyles.error}>
          {error}
        </Text>
      ) : null}
      {syntheticProbeAvailable ? (
        <RecordingControlsProbe
          busy={controlsBusy}
          status={status}
          syntheticProbeReady={syntheticProbeReady}
          onPrepareSyntheticProbe={onPrepareSyntheticProbe}
          onPrepareSyntheticStartFailure={onPrepareSyntheticStartFailure}
          onSendInterruption={onSendInterruption}
          probeError={probeError}
        />
      ) : null}
    </ScrollView>
  );
}
