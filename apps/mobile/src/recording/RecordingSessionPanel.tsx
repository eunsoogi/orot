import { Pressable, View, useWindowDimensions } from 'react-native';
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

// Consent and live session actions stay together; saved-recording actions remain in RecordingControls.
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
  const compact = useWindowDimensions().width < 375;
  return (
    <>
      <Text
        accessibilityRole="header"
        style={[recordingControlStyles.title, styles.heading]}
        testID="recording-title"
      >
        {t('recording.title')}
      </Text>
      <Text style={[recordingControlStyles.copy, styles.heading]}>
        {t('recording.subtitle')}
      </Text>
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
      <View style={styles.session}>
        <View style={recordingControlStyles.recordingStatus}>
          {status === 'recording' ? (
            <View style={recordingControlStyles.liveDot} />
          ) : null}
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.status,
              status === 'recording' ? recordingControlStyles.liveStatus : null,
            ]}
            testID="recording-status"
          >
            {recordingStatusLabel(status)}
          </Text>
        </View>
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
      {/* One large microphone starts or finishes a take; the small icon changes only pause/resume state. */}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={
            status === 'idle' || status === 'completed'
              ? t('recording.start')
              : t('recording.stop')
          }
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              controlsBusy ||
              sourceRetryPending ||
              ((status === 'idle' || status === 'completed') &&
                !consentAcknowledged),
          }}
          disabled={
            controlsBusy ||
            sourceRetryPending ||
            ((status === 'idle' || status === 'completed') &&
              !consentAcknowledged)
          }
          onPress={
            status === 'idle' || status === 'completed' ? onStart : onStop
          }
          style={[styles.microphone, compact && styles.compactMicrophone]}
          testID="recording-microphone-control"
        >
          <View
            style={[
              styles.microphoneInner,
              compact && styles.compactMicrophoneInner,
            ]}
          >
            <AppSymbol name="mic.fill" size={52} color={appColors.onPrimary} />
          </View>
        </Pressable>
        {status === 'recording' ? (
          <Pressable
            accessibilityLabel={t('recording.pauseAccessibility')}
            accessibilityRole="button"
            accessibilityState={{ disabled: controlsBusy }}
            disabled={controlsBusy}
            onPress={onPause}
            style={[
              styles.secondaryAction,
              compact && styles.compactSecondaryAction,
            ]}
            testID="recording-pause"
          >
            <AppSymbol
              name="pause.fill"
              size={27}
              color={appColors.primaryText}
            />
          </Pressable>
        ) : status === 'paused' || status === 'interrupted' ? (
          <Pressable
            accessibilityLabel={t('recording.resume')}
            accessibilityRole="button"
            accessibilityState={{ disabled: controlsBusy }}
            disabled={controlsBusy}
            onPress={onResume}
            style={[
              styles.secondaryAction,
              compact && styles.compactSecondaryAction,
            ]}
            testID="recording-resume"
          >
            <AppSymbol
              name="play.fill"
              size={27}
              color={appColors.primaryText}
            />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.hint}>
        {status === 'recording'
          ? t('recording.microphone.stopHint')
          : status === 'paused' || status === 'interrupted'
            ? t('recording.microphone.pausedHint')
            : t('recording.afterSave')}
      </Text>
      <View style={recordingControlStyles.localNotice}>
        <AppSymbol name="lock.fill" size={20} color={appColors.secondary} />
        <Text style={recordingControlStyles.localNoticeText}>
          {t('recording.localOnly')}
        </Text>
      </View>
    </>
  );
}
