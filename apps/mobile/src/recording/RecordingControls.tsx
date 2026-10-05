import { Button, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import type { CompletedRecording, RecordingStatus } from './recordingTypes';
import { formatRecordingDuration } from './recordingTypes';
import { recordingControlStyles } from './RecordingControls.styles';
import RecordingControlsProbe from './RecordingControlsProbe';

interface RecordingControlsProps {
  onBack: () => void;
  stateReady: boolean;
  status: RecordingStatus;
  durationMs: number;
  consentAcknowledged: boolean;
  onToggleConsent: () => void;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
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
}

function statusLabel(status: RecordingStatus): string {
  switch (status) {
    case 'idle':
      return t('recording.status.idle');
    case 'recording':
      return t('recording.status.recording');
    case 'paused':
      return t('recording.status.paused');
    case 'interrupted':
      return t('recording.status.interrupted');
    case 'completed':
      return t('recording.status.completed');
  }
}

export default function RecordingControls({
  onBack,
  stateReady,
  status,
  durationMs,
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
}: RecordingControlsProps) {
  const sourceRetryPending =
    lastRecording !== null &&
    !sourceSaved &&
    lastRecording.fileProtection === 'complete' &&
    lastRecording.excludedFromBackup;
  const canLeave =
    stateReady &&
    (status === 'idle' || status === 'completed') &&
    !busy &&
    !sourceRetryPending;
  return (
    <View style={recordingControlStyles.container}>
      {canLeave ? (
        <View style={recordingControlStyles.back}>
          <Button
            onPress={onBack}
            testID="recording-back"
            title={t('recording.back')}
          />
        </View>
      ) : null}
      <Text accessibilityRole="header" style={recordingControlStyles.title}>
        {t('recording.title')}
      </Text>
      <Text style={recordingControlStyles.copy}>
        {t('recording.consent.description')}
      </Text>
      <Text style={recordingControlStyles.copy}>
        {t('recording.localOnly')}
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consentAcknowledged }}
        disabled={
          busy ||
          status === 'recording' ||
          status === 'paused' ||
          status === 'interrupted'
        }
        onPress={onToggleConsent}
        style={recordingControlStyles.consentRow}
        testID="recording-consent"
      >
        <Text style={recordingControlStyles.checkbox}>
          {consentAcknowledged ? '☑' : '☐'}
        </Text>
        <Text style={recordingControlStyles.copy}>
          {t('recording.consent.acknowledgement')}
        </Text>
      </Pressable>
      <Text
        accessibilityLiveRegion="polite"
        style={recordingControlStyles.status}
        testID="recording-status"
      >
        {statusLabel(status)}
      </Text>
      <Text style={recordingControlStyles.duration} testID="recording-duration">
        {t('recording.duration', {
          duration: formatRecordingDuration(durationMs),
        })}
      </Text>
      {status === 'idle' || status === 'completed' ? (
        <Button
          disabled={!consentAcknowledged || busy || sourceRetryPending}
          onPress={onStart}
          testID="recording-start"
          title={t('recording.start')}
        />
      ) : null}
      {status === 'recording' ? (
        <Button
          disabled={busy}
          onPress={onPause}
          testID="recording-pause"
          title={t('recording.pause')}
        />
      ) : null}
      {status === 'paused' || status === 'interrupted' ? (
        <Button
          disabled={busy}
          onPress={onResume}
          testID="recording-resume"
          title={t('recording.resume')}
        />
      ) : null}
      {status === 'recording' ||
      status === 'paused' ||
      status === 'interrupted' ? (
        <Button
          disabled={busy}
          onPress={onStop}
          testID="recording-stop"
          title={t('recording.stop')}
        />
      ) : null}
      {lastRecording ? (
        <View style={recordingControlStyles.result} testID="recording-result">
          <Text accessibilityRole="alert" style={recordingControlStyles.status}>
            {sourceSaved ? t('recording.saved') : t('recording.sourcePending')}
          </Text>
          <Text testID="recording-source-id">
            {t('recording.id', { id: lastRecording.id })}
          </Text>
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
      {error ? (
        <Text accessibilityRole="alert" style={recordingControlStyles.error}>
          {error}
        </Text>
      ) : null}
      {syntheticProbeAvailable ? (
        <RecordingControlsProbe
          busy={busy}
          status={status}
          syntheticProbeReady={syntheticProbeReady}
          onPrepareSyntheticProbe={onPrepareSyntheticProbe}
          onPrepareSyntheticStartFailure={onPrepareSyntheticStartFailure}
          onSendInterruption={onSendInterruption}
          probeError={probeError}
        />
      ) : null}
    </View>
  );
}
