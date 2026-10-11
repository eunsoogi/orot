import Button from './RecordingSessionAction';
import { View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import RecordingWaveform from './RecordingWaveform';
import { recordingSessionStyles as styles } from './RecordingSessionPanel.styles';
import { AppText as Text } from '../layout/AppText';
import { RecordingConsentControl } from './RecordingConsentControl';
import { t } from '../i18n';
import { recordingStatusLabel } from './recordingStatusLabel';
import {
  formatRecordingDuration,
  type RecordingStatus,
} from './recordingTypes';
import { recordingControlStyles } from './RecordingControls.styles';

interface RecordingSessionPanelProps {
  status: RecordingStatus;
  durationMs: number;
  amplitude?: number;
  consentAcknowledged: boolean;
  onToggleConsent: () => void;
  controlsBusy: boolean;
  sourceRetryPending: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => Promise<void>;
}

// Consent and session actions stay together; saved-recording actions remain in RecordingControls.
export default function RecordingSessionPanel({
  status,
  durationMs,
  amplitude,
  consentAcknowledged,
  onToggleConsent,
  controlsBusy,
  sourceRetryPending,
  onStart,
  onPause,
  onResume,
  onStop,
}: RecordingSessionPanelProps) {
  return (
    <>
      <Text
        accessibilityRole="header"
        style={recordingControlStyles.title}
        testID="recording-title"
      >
        {t('recording.title')}
      </Text>
      <Text style={recordingControlStyles.copy}>{t('recording.subtitle')}</Text>
      <RecordingConsentControl
        checked={consentAcknowledged}
        onPress={onToggleConsent}
        disabled={
          controlsBusy ||
          status === 'recording' ||
          status === 'paused' ||
          status === 'interrupted'
        }
      />
      <Text style={recordingControlStyles.copy}>
        {t('recording.localOnly')}
      </Text>
      <View style={styles.session}>
        <View style={styles.microphone}>
          <AppSymbol name="mic.fill" size={52} color={appColors.primary} />
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="recording-status"
        >
          {recordingStatusLabel(status)}
        </Text>
        <Text
          accessibilityLabel={t('recording.duration', {
            duration: formatRecordingDuration(durationMs),
          })}
          style={styles.duration}
          testID="recording-duration"
        >
          {formatRecordingDuration(durationMs)}
        </Text>
        <RecordingWaveform
          amplitude={amplitude}
          durationMs={durationMs}
          status={status}
        />
        <Text style={styles.hint}>
          {status === 'recording'
            ? t('recording.listening')
            : status === 'paused' || status === 'interrupted'
              ? recordingStatusLabel(status)
              : t('recording.readyHint')}
        </Text>
      </View>
      <View style={styles.actions}>
        {status === 'idle' || status === 'completed' ? (
          <View style={styles.action}>
            <Button
              disabled={
                !consentAcknowledged || controlsBusy || sourceRetryPending
              }
              icon="mic.fill"
              onPress={onStart}
              testID="recording-start"
              title={t('recording.start')}
            />
          </View>
        ) : null}
        {status === 'recording' ? (
          <View style={styles.action}>
            <Button
              disabled={controlsBusy}
              secondary
              icon="pause.fill"
              onPress={onPause}
              testID="recording-pause"
              title={t('recording.pause')}
            />
          </View>
        ) : null}
        {status === 'paused' || status === 'interrupted' ? (
          <View style={styles.action}>
            <Button
              disabled={controlsBusy}
              secondary
              icon="play.fill"
              onPress={onResume}
              testID="recording-resume"
              title={t('recording.resume')}
            />
          </View>
        ) : null}
        {status === 'recording' ||
        status === 'paused' ||
        status === 'interrupted' ? (
          <View style={styles.action}>
            <Button
              disabled={controlsBusy}
              icon="stop.fill"
              onPress={onStop}
              testID="recording-stop"
              title={t('recording.saveAction')}
            />
          </View>
        ) : null}
      </View>
      <Text style={styles.hint}>{t('recording.afterSave')}</Text>
    </>
  );
}
