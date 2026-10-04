import { Button, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import type { CompletedRecording, RecordingStatus } from './recordingTypes';
import { formatRecordingDuration } from './recordingTypes';

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
  onSendInterruption,
  probeError,
}: RecordingControlsProps) {
  const canLeave =
    stateReady && (status === 'idle' || status === 'completed') && !busy;
  return (
    <View style={styles.container}>
      {canLeave ? (
        <View style={styles.back}>
          <Button
            onPress={onBack}
            testID="recording-back"
            title={t('recording.back')}
          />
        </View>
      ) : null}
      <Text accessibilityRole="header" style={styles.title}>
        {t('recording.title')}
      </Text>
      <Text style={styles.copy}>{t('recording.consent.description')}</Text>
      <Text style={styles.copy}>{t('recording.localOnly')}</Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consentAcknowledged }}
        disabled={busy || status === 'recording' || status === 'paused' || status === 'interrupted'}
        onPress={onToggleConsent}
        style={styles.consentRow}
        testID="recording-consent"
      >
        <Text style={styles.checkbox}>{consentAcknowledged ? '☑' : '☐'}</Text>
        <Text style={styles.copy}>{t('recording.consent.acknowledgement')}</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={styles.status} testID="recording-status">
        {statusLabel(status)}
      </Text>
      <Text style={styles.duration} testID="recording-duration">
        {t('recording.duration', { duration: formatRecordingDuration(durationMs) })}
      </Text>
      {status === 'idle' || status === 'completed' ? (
        <Button
          disabled={!consentAcknowledged || busy}
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
      {status === 'recording' || status === 'paused' || status === 'interrupted' ? (
        <Button
          disabled={busy}
          onPress={onStop}
          testID="recording-stop"
          title={t('recording.stop')}
        />
      ) : null}
      {lastRecording ? (
        <View style={styles.result} testID="recording-result">
          <Text accessibilityRole="alert" style={styles.status}>
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
          {!sourceSaved && lastRecording.fileProtection === 'complete' && lastRecording.excludedFromBackup ? (
            <Button
              disabled={busy}
              onPress={onRetrySourceSave}
              testID="recording-retry-save"
              title={t('recording.retrySave')}
            />
          ) : null}
          {__DEV__ ? (
            <Text testID="recording-file-protection">
              {lastRecording.fileProtection}:{String(lastRecording.excludedFromBackup)}
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {syntheticProbeAvailable ? (
        <View style={styles.probe} testID="recording-synthetic-probe">
          <Button
            disabled={busy || status === 'recording' || status === 'paused' || status === 'interrupted'}
            onPress={onPrepareSyntheticProbe}
            testID="recording-probe-synthetic"
            title={t('recording.probe.synthetic')}
          />
          {syntheticProbeReady && (status === 'recording' || status === 'interrupted') ? (
            <>
              {status === 'recording' ? (
                <Button
                  onPress={() => onSendInterruption('began')}
                  testID="recording-probe-interruption-began"
                  title={t('recording.probe.interruptionBegan')}
                />
              ) : null}
              {status === 'interrupted' ? (
                <Button
                  onPress={() => onSendInterruption('ended')}
                  testID="recording-probe-interruption-ended"
                  title={t('recording.probe.interruptionEnded')}
                />
              ) : null}
            </>
          ) : null}
          {probeError ? <Text accessibilityRole="alert">{probeError}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  back: { alignSelf: 'flex-start' },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  copy: { color: '#45515f', fontSize: 16, lineHeight: 22 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { color: '#17212b', fontSize: 22 },
  status: { color: '#17212b', fontSize: 18, fontWeight: '700' },
  duration: { color: '#45515f', fontSize: 16 },
  result: { gap: 8 },
  error: { color: '#9f1d1d', fontSize: 15 },
  probe: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
